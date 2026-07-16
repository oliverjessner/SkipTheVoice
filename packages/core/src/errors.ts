export type ErrorCode =
  | "CONNECTION_NOT_FOUND" | "VOICE_MESSAGE_NOT_FOUND" | "AUDIO_FILE_MISSING"
  | "AUDIO_FILE_INVALID" | "TRANSCRIPTION_ALREADY_ACTIVE" | "WHISPER_WORKER_UNAVAILABLE"
  | "WHISPER_MODEL_LOAD_FAILED" | "TRANSCRIPTION_FAILED" | "TRANSCRIPTION_CANCELLED"
  | "FORBIDDEN" | "DATABASE_BUSY" | "USER_NOT_FOUND" | "VALIDATION_ERROR";

export class AppError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly status = 400) { super(message); this.name = "AppError"; }
}

export function publicError(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof AppError) return { code: error.code, message: error.message, status: error.status };
  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", status: 500 };
}
