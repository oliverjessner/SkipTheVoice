from __future__ import annotations
import asyncio
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from app.services.jobs import JobStore
from app.services.model import ModelManager

app = FastAPI(title="SkipTheVoice Whisper Worker", version="0.1.0")
models = ModelManager()
jobs = JobStore(models)


def authorize(authorization: str | None = Header(default=None)) -> None:
    token = os.getenv("WHISPER_WORKER_INTERNAL_TOKEN", "change-me")
    if token and authorization != f"Bearer {token}":
        raise HTTPException(401, "The internal worker token is invalid.")


@app.get("/health")
def health(_: None = Depends(authorize)):
    ffmpeg = shutil.which(os.getenv("FFMPEG_PATH", "ffmpeg")) is not None
    return {"healthy": ffmpeg and models.state != "error", "ffmpeg": ffmpeg, "modelState": models.state,
            "model": models.model_name, "device": models.selected_device(),
            "activeJobs": sum(job.status not in {"completed", "failed", "cancelled"} for job in jobs.jobs.values()),
            "capacity": int(os.getenv("WHISPER_MAX_CONCURRENT_JOBS", "1"))}


@app.get("/v1/model")
def model_status(_: None = Depends(authorize)):
    return {"state": models.state, "model": models.model_name, "device": models.selected_device(), "error": models.error}


@app.post("/v1/transcriptions", status_code=202)
async def create_transcription(audio: UploadFile = File(), voice_message_id: str = Form(), correlation_id: str = Form(),
                               requested_language: str | None = Form(default=None), model: str = Form(default="turbo"),
                               _: None = Depends(authorize)):
    maximum = int(float(os.getenv("MAX_AUDIO_FILE_SIZE_MB", "25")) * 1024 * 1024)
    directory = Path(tempfile.mkdtemp(prefix="skipthevoice-whisper-"))
    target = directory / "input.audio"
    size = 0
    with target.open("wb") as destination:
        while chunk := await audio.read(1024 * 1024):
            size += len(chunk)
            if size > maximum:
                shutil.rmtree(directory, ignore_errors=True)
                raise HTTPException(413, "The audio file exceeds the configured size limit.")
            destination.write(chunk)
    if not size:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(400, "The audio file is empty.")
    job = await jobs.create(target, voice_message_id, requested_language, model)
    return {"jobId": job.id, "correlationId": correlation_id}


def find_job(job_id: str):
    job = jobs.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "The transcription job was not found.")
    return job


@app.get("/v1/transcriptions/{job_id}")
def get_transcription(job_id: str, _: None = Depends(authorize)):
    job = find_job(job_id)
    return job.events[-1] if job.events else {"phase": job.status, "sequence": 0, "elapsedMilliseconds": 0}


@app.get("/v1/transcriptions/{job_id}/events")
async def transcription_events(job_id: str, _: None = Depends(authorize)):
    job = find_job(job_id)
    async def stream():
        index = 0
        while True:
            while index < len(job.events):
                event = job.events[index]
                yield f"id: {event['sequence']}\nevent: {event['type']}\ndata: {json.dumps(event)}\n\n"
                index += 1
            if job.status in {"completed", "failed", "cancelled"}:
                break
            try:
                async with job.condition:
                    await asyncio.wait_for(job.condition.wait(), timeout=15)
            except TimeoutError:
                yield ": heartbeat\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/v1/transcriptions/{job_id}/cancel", status_code=202)
async def cancel_transcription(job_id: str, _: None = Depends(authorize)):
    job = find_job(job_id)
    await jobs.cancel(job)
    return {"cancelRequested": True, "jobId": job.id}
