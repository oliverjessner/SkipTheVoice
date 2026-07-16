import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { AppError, defaultUserDataRoot, getConfig, type SkipTheVoiceApplication } from "@skipthevoice/core";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function packagedWorkerRoot(): string | undefined {
  const candidates = [
    path.join(moduleDirectory, "worker"),
    path.resolve(moduleDirectory, "../../../apps/whisper-worker"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "app", "main.py")));
}

export function configurePackagedMediaTools(): void {
  if (!existsSync(path.join(moduleDirectory, "worker"))) return;
  if (!process.env.FFMPEG_PATH) {
    try {
      process.env.FFMPEG_PATH = (require("@ffmpeg-installer/ffmpeg") as { path: string }).path;
      if (process.platform !== "win32") chmodSync(process.env.FFMPEG_PATH, 0o755);
    } catch { /* Homebrew and system installs provide ffmpeg on PATH. */ }
  }
  if (!process.env.FFPROBE_PATH) {
    try {
      process.env.FFPROBE_PATH = (require("@ffprobe-installer/ffprobe") as { path: string }).path;
      if (process.platform !== "win32") chmodSync(process.env.FFPROBE_PATH, 0o755);
    } catch { /* Homebrew and system installs provide ffprobe on PATH. */ }
  }
}

function runtimePython(): string | undefined {
  if (process.env.SKIPTHEVOICE_WHISPER_PYTHON) return process.env.SKIPTHEVOICE_WHISPER_PYTHON;
  const executable = process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python");
  const candidates = [
    path.join(process.env.SKIPTHEVOICE_RUNTIME_DIRECTORY ?? path.join(defaultUserDataRoot(), "runtime"), "whisper-venv", executable),
    path.join(getConfig().projectRoot, ".venv", executable),
  ];
  return candidates.find(existsSync);
}

function installPackagedRuntime(): string | undefined {
  const installer = path.resolve(moduleDirectory, "../scripts/install-runtime.mjs");
  if (!existsSync(installer)) return undefined;
  const result = spawnSync(process.execPath, [installer], { stdio: "inherit", env: process.env });
  if (result.status !== 0) return undefined;
  return runtimePython();
}

export interface ManagedWhisperWorker {
  stop(): Promise<void>;
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  child.kill("SIGTERM");
  return Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(3_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

export async function ensureWhisperWorker(app: SkipTheVoiceApplication): Promise<ManagedWhisperWorker | undefined> {
  const current = await app.whisper.healthCheck();
  if (current.healthy) return undefined;
  const url = new URL(getConfig().whisperWorkerUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new AppError("WHISPER_WORKER_UNAVAILABLE", current.error ?? "The configured Whisper worker is unavailable.", 503);
  }
  const workerRoot = packagedWorkerRoot();
  const python = runtimePython() ?? installPackagedRuntime();
  if (!workerRoot || !python || spawnSync(python, ["--version"], { stdio: "ignore" }).status !== 0) {
    throw new AppError("WHISPER_WORKER_UNAVAILABLE", "The local Whisper runtime is not installed. Reinstall SkipTheVoice with npm or Homebrew.", 503);
  }
  const child = spawn(python, ["-m", "uvicorn", "app.main:app", "--app-dir", workerRoot, "--host", url.hostname, "--port", url.port || "8090"], {
    env: { ...process.env, WHISPER_WORKER_INTERNAL_TOKEN: getConfig().whisperInternalToken },
    stdio: "ignore",
  });
  let exited = false;
  child.once("exit", () => { exited = true; });
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(250);
    const health = await app.whisper.healthCheck();
    if (health.healthy) return { stop: () => stopChild(child) };
    if (exited) break;
  }
  await stopChild(child);
  throw new AppError("WHISPER_WORKER_UNAVAILABLE", "The local Whisper worker could not be started.", 503);
}
