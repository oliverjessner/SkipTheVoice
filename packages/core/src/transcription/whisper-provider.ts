import { openAsBlob } from "node:fs";
import { getConfig, type AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { TranscriptionInput, TranscriptionProgress, TranscriptionProvider, TranscriptionProviderHealth, TranscriptionResult } from "./types.js";

export class SelfHostedWhisperProvider implements TranscriptionProvider {
  readonly providerType = "self_hosted_whisper";
  constructor(private readonly config: AppConfig = getConfig()) {}
  private headers(): HeadersInit { return this.config.whisperInternalToken ? { Authorization: `Bearer ${this.config.whisperInternalToken}` } : {}; }
  private async checked(response: Response): Promise<Response> { if (!response.ok) { const body = await response.json().catch(() => ({})) as any; throw new AppError("WHISPER_WORKER_UNAVAILABLE", body.detail ?? `Whisper worker returned HTTP ${response.status}.`, 502); } return response; }
  async startJob(input: TranscriptionInput) {
    const form = new FormData(); form.set("audio", await openAsBlob(input.filePath), "audio"); form.set("voice_message_id", input.voiceMessageId); form.set("correlation_id", input.correlationId ?? input.voiceMessageId); form.set("model", input.model ?? this.config.whisperModel); if (input.requestedLanguage) form.set("requested_language", input.requestedLanguage);
    const response = await this.checked(await fetch(`${this.config.whisperWorkerUrl}/v1/transcriptions`, { method: "POST", headers: this.headers(), body: form }));
    const body = await response.json() as { jobId: string }; return { externalJobId: body.jobId };
  }
  async getJob(externalJobId: string): Promise<TranscriptionProgress> { const response = await this.checked(await fetch(`${this.config.whisperWorkerUrl}/v1/transcriptions/${encodeURIComponent(externalJobId)}`, { headers: this.headers() })); return response.json() as Promise<TranscriptionProgress>; }
  async streamProgress(externalJobId: string, onProgress: (progress: TranscriptionProgress) => Promise<void> | void): Promise<TranscriptionResult> {
    const response = await this.checked(await fetch(`${this.config.whisperWorkerUrl}/v1/transcriptions/${encodeURIComponent(externalJobId)}/events`, { headers: { ...this.headers(), Accept: "text/event-stream" } }));
    if (!response.body) throw new AppError("WHISPER_WORKER_UNAVAILABLE", "The Whisper worker returned an empty event stream.", 502);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", result: TranscriptionResult | undefined, lastSequence = -1;
    while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done }); const blocks = buffer.split("\n\n"); buffer = blocks.pop() ?? ""; for (const block of blocks) { const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n"); if (!data) continue; const event = JSON.parse(data); if (event.sequence <= lastSequence) continue; lastSequence = event.sequence; if (event.type === "transcription.completed") result = event.result; await onProgress({ phase: event.phase, progressType: event.progressType, percent: event.overallPercent, phasePercent: event.phasePercent, processedAudioSeconds: event.processedAudioSeconds, totalAudioSeconds: event.totalAudioSeconds, estimatedRemainingSeconds: event.estimatedRemainingSeconds, elapsedMilliseconds: event.elapsedMilliseconds ?? 0, partialText: event.partialText, sequence: event.sequence, updatedAt: event.updatedAt ?? new Date().toISOString() }); if (event.type === "transcription.failed") throw new AppError("TRANSCRIPTION_FAILED", event.error ?? "Transcription failed."); if (event.type === "transcription.cancelled") throw new AppError("TRANSCRIPTION_CANCELLED", "Transcription was cancelled."); } if (done) break; }
    if (!result) throw new AppError("TRANSCRIPTION_FAILED", "The Whisper worker stream ended without a result."); return result;
  }
  async cancelJob(externalJobId: string): Promise<void> { await this.checked(await fetch(`${this.config.whisperWorkerUrl}/v1/transcriptions/${encodeURIComponent(externalJobId)}/cancel`, { method: "POST", headers: this.headers() })); }
  async healthCheck(): Promise<TranscriptionProviderHealth> { try { const response = await this.checked(await fetch(`${this.config.whisperWorkerUrl}/health`, { headers: this.headers(), signal: AbortSignal.timeout(3000) })); return response.json() as Promise<TranscriptionProviderHealth>; } catch (error) { return { healthy: false, error: error instanceof Error ? error.message : "Unavailable" }; } }
}
