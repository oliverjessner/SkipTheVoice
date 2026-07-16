export type TranscriptionPhase = "queued" | "preparing_audio" | "loading_model" | "transcribing" | "finalizing" | "completed" | "failed" | "cancelled";
export type ProgressType = "exact" | "estimated" | "indeterminate";
export interface TranscriptionInput { voiceMessageId: string; filePath: string; mimeType: string; requestedLanguage?: string; model?: string; correlationId?: string }
export interface TranscriptionResult { text: string; detectedLanguage?: string; model: string; durationMilliseconds: number; audioDurationSeconds: number; realTimeFactor?: number }
export interface TranscriptionProgress { phase: TranscriptionPhase; progressType: ProgressType; percent?: number; phasePercent?: number; processedAudioSeconds?: number; totalAudioSeconds?: number; estimatedRemainingSeconds?: number; elapsedMilliseconds: number; partialText?: string; sequence: number; updatedAt: string }
export interface TranscriptionProviderHealth { healthy: boolean; modelState?: string; model?: string; device?: string; activeJobs?: number; capacity?: number; error?: string }
export interface TranscriptionProvider {
  readonly providerType: string;
  startJob(input: TranscriptionInput): Promise<{ externalJobId: string }>;
  getJob(externalJobId: string): Promise<TranscriptionProgress>;
  streamProgress(externalJobId: string, onProgress: (progress: TranscriptionProgress) => Promise<void> | void): Promise<TranscriptionResult>;
  cancelJob(externalJobId: string): Promise<void>;
  healthCheck(): Promise<TranscriptionProviderHealth>;
}
