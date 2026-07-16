import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const booleanString = z.string().optional().transform((value) => value === "true");

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DEFAULT_USER_ID: z.string().min(1).default("dev-user"),
  DATABASE_URL: z.string().startsWith("file:").default("file:./data/database/skipthevoice.db"),
  DATA_DIRECTORY: z.string().min(1).default("./data"),
  AUDIO_DIRECTORY: z.string().min(1).default("./data/audio"),
  MESSENGER_CREDENTIALS_DIRECTORY: z.string().min(1).default("./data/credentials"),
  EXPORT_DIRECTORY: z.string().min(1).default("./data/exports"),
  SQLITE_BUSY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  WHISPER_WORKER_URL: z.url().default("http://localhost:8090"),
  WHISPER_WORKER_INTERNAL_TOKEN: z.string().default("change-me"),
  WHISPER_MODEL: z.string().min(1).default("turbo"),
  WHISPER_DEVICE: z.enum(["auto", "cpu", "cuda", "mps"]).default("auto"),
  WHISPER_LANGUAGE: z.string().default(""),
  WHISPER_TASK: z.literal("transcribe").default("transcribe"),
  WHISPER_MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(1),
  WHISPER_MOCK: booleanString,
  FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  FFPROBE_PATH: z.string().min(1).default("ffprobe"),
  MAX_AUDIO_FILE_SIZE_MB: z.coerce.number().positive().default(25),
  MAX_AUDIO_DURATION_SECONDS: z.coerce.number().positive().default(1800),
  TRANSCRIPTION_PROGRESS_PERSIST_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  TRANSCRIPTION_STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(120),
  TRANSCRIPTION_ETA_MINIMUM_SAMPLES: z.coerce.number().int().min(2).default(4),
  TRANSCRIPTION_ETA_SMOOTHING_ALPHA: z.coerce.number().min(0.01).max(1).default(0.25),
  LOG_LEVEL: z.string().default("info"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

function findProjectRoot(startDirectory: string): string | undefined {
  let directory = path.resolve(startDirectory);
  while (true) {
    const packagePath = path.join(directory, "package.json");
    if (existsSync(packagePath)) {
      try {
        const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; workspaces?: unknown };
        if (manifest.name === "skipthevoice" && manifest.workspaces) return directory;
      } catch {
        // Continue searching for the workspace root when a parent manifest is unreadable.
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function defaultUserDataRoot(): string {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "SkipTheVoice");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? os.homedir(), "SkipTheVoice");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "skipthevoice");
}

export function resolveApplicationRoot(currentDirectory = process.cwd(), moduleDirectory = path.dirname(fileURLToPath(import.meta.url))): string {
  return process.env.SKIPTHEVOICE_PROJECT_ROOT
    ? path.resolve(process.env.SKIPTHEVOICE_PROJECT_ROOT)
    : findProjectRoot(currentDirectory) ?? findProjectRoot(moduleDirectory) ?? defaultUserDataRoot();
}

function loadRootEnvironment(root: string): void {
  const environmentPath = path.join(root, ".env");
  if (!existsSync(environmentPath)) return;
  try { process.loadEnvFile(environmentPath); } catch (error) {
    throw new Error(`Environment file is invalid: ${(error as Error).message}`);
  }
}

export function defaultConfigPath(): string {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "SkipTheVoice", "config.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), "SkipTheVoice", "config.json");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "skipthevoice", "config.json");
}

export function loadConfig(configPath?: string, overrides: Record<string, unknown> = {}) {
  const root = resolveApplicationRoot();
  loadRootEnvironment(root);
  let file: Record<string, unknown> = {};
  const selectedPath = configPath ?? defaultConfigPath();
  try { file = JSON.parse(readFileSync(selectedPath, "utf8")) as Record<string, unknown>; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Configuration file is invalid: ${(error as Error).message}`);
  }
  const parsed = environmentSchema.safeParse({ ...file, ...process.env, ...overrides });
  if (!parsed.success) throw new Error(`Configuration is invalid: ${z.prettifyError(parsed.error)}`);
  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    appBaseUrl: value.APP_BASE_URL,
    defaultUserId: value.DEFAULT_USER_ID,
    projectRoot: root,
    databasePath: path.resolve(root, value.DATABASE_URL.slice(5)),
    dataDirectory: path.resolve(root, value.DATA_DIRECTORY),
    audioDirectory: path.resolve(root, value.AUDIO_DIRECTORY),
    credentialsDirectory: path.resolve(root, value.MESSENGER_CREDENTIALS_DIRECTORY),
    exportDirectory: path.resolve(root, value.EXPORT_DIRECTORY),
    sqliteBusyTimeoutMs: value.SQLITE_BUSY_TIMEOUT_MS,
    whisperWorkerUrl: value.WHISPER_WORKER_URL.replace(/\/$/, ""),
    whisperInternalToken: value.WHISPER_WORKER_INTERNAL_TOKEN,
    whisperModel: value.WHISPER_MODEL,
    whisperDevice: value.WHISPER_DEVICE,
    whisperLanguage: value.WHISPER_LANGUAGE || undefined,
    whisperTask: value.WHISPER_TASK,
    whisperMaxConcurrentJobs: value.WHISPER_MAX_CONCURRENT_JOBS,
    whisperMock: value.WHISPER_MOCK,
    ffmpegPath: value.FFMPEG_PATH,
    ffprobePath: value.FFPROBE_PATH,
    maxAudioFileSizeBytes: Math.floor(value.MAX_AUDIO_FILE_SIZE_MB * 1024 * 1024),
    maxAudioDurationSeconds: value.MAX_AUDIO_DURATION_SECONDS,
    progressPersistIntervalMs: value.TRANSCRIPTION_PROGRESS_PERSIST_INTERVAL_MS,
    staleAfterSeconds: value.TRANSCRIPTION_STALE_AFTER_SECONDS,
    etaMinimumSamples: value.TRANSCRIPTION_ETA_MINIMUM_SAMPLES,
    etaSmoothingAlpha: value.TRANSCRIPTION_ETA_SMOOTHING_ALPHA,
    logLevel: value.LOG_LEVEL,
    configPath: selectedPath,
  };
}

let cachedConfig: AppConfig | undefined;
export function getConfig(): AppConfig { return cachedConfig ??= loadConfig(); }
export function initializeConfig(configPath?: string, overrides: Record<string, unknown> = {}): AppConfig {
  return cachedConfig = loadConfig(configPath, overrides);
}
export function resetConfig(): void { cachedConfig = undefined; }
