import { createReadStream, createWriteStream, existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { getConfig, type AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { resolveInside, safePathComponent } from "../security/paths.js";

const MIME_EXTENSIONS: Record<string, string[]> = { "audio/ogg": ["ogg", "opus"], "audio/opus": ["opus", "ogg"], "audio/mpeg": ["mp3"], "audio/mp4": ["m4a", "mp4"], "audio/wav": ["wav"], "audio/x-wav": ["wav"], "audio/webm": ["webm"] };

export interface AudioInfo { durationSeconds: number; codec: string; sampleRate: number; channels: number }

export class AudioStorage {
  constructor(private readonly config: AppConfig = getConfig()) {}
  messageDirectory(userId: string, connectionId: string, voiceMessageId: string): string { return resolveInside(this.config.dataDirectory, "users", userId, "connections", connectionId, "audio", voiceMessageId); }
  originalPath(userId: string, connectionId: string, voiceMessageId: string, extension: string): string { return path.join(this.messageDirectory(userId, connectionId, voiceMessageId), `original.${safePathComponent(extension)}`); }
  normalizedPath(userId: string, connectionId: string, voiceMessageId: string): string { return path.join(this.messageDirectory(userId, connectionId, voiceMessageId), "normalized.wav"); }
  validateType(mimeType: string, extension: string): void { if (!MIME_EXTENSIONS[mimeType]?.includes(extension.toLowerCase())) throw new AppError("AUDIO_FILE_INVALID", "The audio MIME type or extension is not supported."); }
  async store(source: NodeJS.ReadableStream, destination: string): Promise<number> {
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${process.pid}.tmp`; let size = 0;
    source.on("data", (chunk: Buffer) => { size += chunk.length; if (size > this.config.maxAudioFileSizeBytes) (source as NodeJS.ReadableStream & { destroy(error?: Error): void }).destroy(new AppError("AUDIO_FILE_INVALID", "The audio file exceeds the configured size limit.")); });
    try { await pipeline(source, createWriteStream(temporary, { mode: 0o600, flags: "wx" })); if (!size) throw new AppError("AUDIO_FILE_INVALID", "The audio file is empty."); await fs.rename(temporary, destination); return size; } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
  }
  async inspect(filePath: string): Promise<AudioInfo> {
    if (!existsSync(filePath)) throw new AppError("AUDIO_FILE_MISSING", "The audio file is unavailable.", 404);
    const result = await runProcess(this.config.ffprobePath, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", filePath], 30_000);
    try { const parsed = JSON.parse(result.stdout); const stream = parsed.streams?.[0], duration = Number(parsed.format?.duration); if (!stream || !Number.isFinite(duration) || duration <= 0 || duration > this.config.maxAudioDurationSeconds) throw new Error("Invalid duration"); return { durationSeconds: duration, codec: String(stream.codec_name), sampleRate: Number(stream.sample_rate), channels: Number(stream.channels) }; }
    catch { throw new AppError("AUDIO_FILE_INVALID", "The audio file is corrupt or exceeds the configured duration limit."); }
  }
  async normalize(source: string, destination: string): Promise<void> { mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 }); const temporary = `${destination}.${process.pid}.tmp`; try { await runProcess(this.config.ffmpegPath, ["-v", "error", "-y", "-i", source, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", temporary], 120_000); await fs.rename(temporary, destination); } catch (error) { await fs.rm(temporary, { force: true }); throw error; } }
  createStream(filePath: string, start?: number, end?: number) { return createReadStream(filePath, start === undefined ? {} : { start, end }); }
  async deleteMessageFiles(userId: string, connectionId: string, voiceMessageId: string): Promise<void> { await fs.rm(this.messageDirectory(userId, connectionId, voiceMessageId), { recursive: true, force: true }); }
}

export async function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => { const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new AppError("AUDIO_FILE_INVALID", "Audio processing timed out.")); }, timeoutMs); child.stdout.on("data", (data) => stdout += String(data).slice(0, 100_000)); child.stderr.on("data", (data) => stderr += String(data).slice(0, 20_000)); child.on("error", reject); child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(new AppError("AUDIO_FILE_INVALID", "Audio processing failed.")); }); });
}
