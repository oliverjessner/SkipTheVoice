from __future__ import annotations
import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from app.progress.eta import EtaEstimator
from app.services.model import ModelManager


def overall(phase: str, phase_percent: float = 0) -> float:
    ratio = min(100.0, max(0.0, phase_percent)) / 100
    return {"queued": 0, "preparing_audio": 5 + ratio * 10, "loading_model": 15 + ratio * 5,
            "transcribing": 20 + ratio * 75, "finalizing": 95 + ratio * 4,
            "completed": 100}.get(phase, phase_percent)


@dataclass
class Job:
    id: str
    audio_path: Path
    voice_message_id: str
    requested_language: str | None
    model: str
    events: list[dict[str, Any]] = field(default_factory=list)
    status: str = "queued"
    cancelled: bool = False
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    result: dict[str, Any] | None = None
    error: str | None = None


class JobStore:
    def __init__(self, model_manager: ModelManager) -> None:
        self.model_manager = model_manager
        self.jobs: dict[str, Job] = {}
        self.loop: asyncio.AbstractEventLoop | None = None
        self.semaphore = asyncio.Semaphore(int(os.getenv("WHISPER_MAX_CONCURRENT_JOBS", "1")))

    async def create(self, audio_path: Path, voice_message_id: str, language: str | None, model: str) -> Job:
        job = Job(f"whisper_{uuid.uuid4().hex[:20]}", audio_path, voice_message_id, language, model)
        self.jobs[job.id] = job
        await self.emit(job, "job.queued", "queued", "indeterminate", 0)
        asyncio.create_task(self.run(job))
        return job

    async def emit(self, job: Job, event_type: str, phase: str, progress_type: str, phase_percent: float = 0, **extra: Any) -> None:
        event = {"type": event_type, "jobId": job.id, "sequence": len(job.events), "phase": phase,
                 "progressType": progress_type, "phasePercent": round(phase_percent, 1),
                 "overallPercent": round(overall(phase, phase_percent), 1), "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **extra}
        job.events.append(event)
        async with job.condition:
            job.condition.notify_all()

    async def run(self, job: Job) -> None:
        async with self.semaphore:
            started = time.monotonic()
            try:
                job.status = "preparing_audio"
                await self.emit(job, "audio.preparing", "preparing_audio", "indeterminate", 20, elapsedMilliseconds=0)
                normalized, duration = await asyncio.to_thread(self.normalize, job.audio_path)
                await self.emit(job, "audio.preparing", "preparing_audio", "exact", 100, totalAudioSeconds=duration, elapsedMilliseconds=int((time.monotonic()-started)*1000))
                if job.cancelled:
                    raise asyncio.CancelledError
                if self.model_manager.state != "ready" and os.getenv("WHISPER_MOCK", "false").lower() != "true":
                    job.status = "loading_model"
                    await self.emit(job, "model.loading", "loading_model", "indeterminate", 0, totalAudioSeconds=duration, elapsedMilliseconds=int((time.monotonic()-started)*1000))
                    await asyncio.to_thread(self.model_manager.load, job.model)
                    await self.emit(job, "model.loading", "loading_model", "exact", 100, totalAudioSeconds=duration, elapsedMilliseconds=int((time.monotonic()-started)*1000))
                job.status = "transcribing"
                result = await (self.mock_transcribe(job, duration, started) if os.getenv("WHISPER_MOCK", "false").lower() == "true" else self.transcribe(job, normalized, duration, started))
                if job.cancelled:
                    raise asyncio.CancelledError
                job.status = "finalizing"
                await self.emit(job, "transcription.finalizing", "finalizing", "indeterminate", 30, elapsedMilliseconds=int((time.monotonic()-started)*1000))
                text = " ".join(result["segments"]).strip()
                elapsed_ms = int((time.monotonic()-started)*1000)
                job.result = {"text": text, "detectedLanguage": result.get("language"), "model": job.model,
                              "durationMilliseconds": elapsed_ms, "audioDurationSeconds": duration,
                              "realTimeFactor": elapsed_ms / 1000 / duration if duration else None}
                job.status = "completed"
                await self.emit(job, "transcription.completed", "completed", "exact", 100, processedAudioSeconds=duration,
                                totalAudioSeconds=duration, estimatedRemainingSeconds=0, elapsedMilliseconds=elapsed_ms,
                                partialText=text, result=job.result)
            except asyncio.CancelledError:
                job.status = "cancelled"
                await self.emit(job, "transcription.cancelled", "cancelled", "indeterminate", 0, elapsedMilliseconds=int((time.monotonic()-started)*1000))
            except Exception as exc:
                job.status, job.error = "failed", str(exc)
                await self.emit(job, "transcription.failed", "failed", "indeterminate", 0, error="Transcription failed in the Whisper worker.", elapsedMilliseconds=int((time.monotonic()-started)*1000))
            finally:
                shutil.rmtree(job.audio_path.parent, ignore_errors=True)

    def normalize(self, source: Path) -> tuple[Path, float]:
        output = source.parent / "normalized.wav"
        subprocess.run([os.getenv("FFMPEG_PATH", "ffmpeg"), "-v", "error", "-y", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(output)], check=True, timeout=120, capture_output=True)
        with wave.open(str(output), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
        maximum = float(os.getenv("MAX_AUDIO_DURATION_SECONDS", "1800"))
        if duration <= 0 or duration > maximum:
            raise ValueError("Audio duration is invalid or exceeds the configured limit.")
        return output, duration

    async def mock_transcribe(self, job: Job, duration: float, started: float) -> dict[str, Any]:
        words = ["Mock", "transcription", "completed", "successfully."]
        segments: list[str] = []
        eta = EtaEstimator(int(os.getenv("TRANSCRIPTION_ETA_MINIMUM_SAMPLES", "4")), float(os.getenv("TRANSCRIPTION_ETA_SMOOTHING_ALPHA", ".25")))
        for index in range(1, 9):
            if job.cancelled:
                raise asyncio.CancelledError
            await asyncio.sleep(float(os.getenv("WHISPER_MOCK_STEP_DELAY", ".2")))
            processed = duration * index / 8
            elapsed = time.monotonic() - started
            segments = [" ".join(words[:max(1, round(len(words)*index/8))])]
            estimate = eta.update(processed, duration, elapsed)
            await self.emit(job, "transcription.segment", "transcribing", "exact", index/8*100,
                            processedAudioSeconds=processed, totalAudioSeconds=duration,
                            estimatedRemainingSeconds=estimate, elapsedMilliseconds=int(elapsed*1000), partialText=segments[0])
        return {"segments": segments, "language": job.requested_language or "en"}

    async def transcribe(self, job: Job, normalized: Path, duration: float, started: float) -> dict[str, Any]:
        chunk_seconds = 30.0
        chunks = max(1, int((duration + chunk_seconds - .001) // chunk_seconds))
        segments: list[str] = []
        detected: str | None = None
        eta = EtaEstimator(int(os.getenv("TRANSCRIPTION_ETA_MINIMUM_SAMPLES", "4")), float(os.getenv("TRANSCRIPTION_ETA_SMOOTHING_ALPHA", ".25")))
        for index in range(chunks):
            if job.cancelled:
                raise asyncio.CancelledError
            chunk = normalized.parent / f"chunk-{index}.wav"
            await asyncio.to_thread(subprocess.run, [os.getenv("FFMPEG_PATH", "ffmpeg"), "-v", "error", "-y", "-ss", str(index*chunk_seconds), "-t", str(chunk_seconds), "-i", str(normalized), str(chunk)], check=True, timeout=120, capture_output=True)
            result = await asyncio.to_thread(self.model_manager.model.transcribe, str(chunk), language=job.requested_language, task="transcribe", fp16=self.model_manager.selected_device() == "cuda", verbose=False)
            text = str(result.get("text", "")).strip()
            if text:
                segments.append(text)
            detected = result.get("language") or detected
            processed = min(duration, (index+1)*chunk_seconds)
            elapsed = time.monotonic()-started
            estimate = eta.update(processed, duration, elapsed)
            await self.emit(job, "transcription.segment", "transcribing", "exact", processed/duration*100,
                            processedAudioSeconds=processed, totalAudioSeconds=duration,
                            estimatedRemainingSeconds=estimate, elapsedMilliseconds=int(elapsed*1000), partialText=" ".join(segments))
        return {"segments": segments, "language": detected}

    async def cancel(self, job: Job) -> None:
        job.cancelled = True
