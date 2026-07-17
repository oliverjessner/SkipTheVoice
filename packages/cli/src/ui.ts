import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { JobRunner, getConfig, type SkipTheVoiceApplication } from "@skipthevoice/core";
import { ensureWhisperWorker, type ManagedWhisperWorker } from "./runtime.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function webServerPath(): string | undefined {
  return [
    path.join(moduleDirectory, "web", "server.js"),
    path.resolve(moduleDirectory, "../dist/web/server.js"),
  ].find(existsSync);
}

function schemaPath(): string | undefined {
  return [
    path.join(moduleDirectory, "schema.sql"),
    path.resolve(moduleDirectory, "../dist/schema.sql"),
    path.resolve(moduleDirectory, "../../core/src/database/schema.sql"),
  ].find(existsSync);
}

async function uiIsAvailable(url: URL): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const health = await response.json() as { database?: unknown; nodeRunner?: unknown };
    return health.database === true && Boolean(health.nodeRunner);
  } catch {
    return false;
  }
}

function openBrowser(url: string): void {
  if (process.env.SKIPTHEVOICE_NO_BROWSER === "1") return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
  child.on("error", () => undefined);
  child.unref();
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(3_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

async function waitForUi(url: URL, server: ChildProcess): Promise<void> {
  let launchError: Error | undefined;
  server.once("error", (error) => { launchError = error; });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await uiIsAvailable(url)) return;
    if (launchError) throw new Error(`The local UI server could not be started: ${launchError.message}`, { cause: launchError });
    if (server.exitCode !== null) throw new Error(`The local UI server exited with status ${server.exitCode}.`);
    await delay(250);
  }
  throw new Error(`The local UI did not become available at ${url.toString()}.`);
}

function localHost(url: URL): string {
  if (url.protocol !== "http:") throw new Error("The local UI requires an http:// APP_BASE_URL.");
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "127.0.0.1";
  if (url.hostname === "[::1]" || url.hostname === "::1") return "::1";
  throw new Error("The local UI must use localhost, 127.0.0.1, or ::1 in APP_BASE_URL.");
}

export async function launchUi(app: SkipTheVoiceApplication): Promise<void> {
  const url = new URL(getConfig().appBaseUrl);
  if (await uiIsAvailable(url)) {
    console.log(`SkipTheVoice is already running at ${url.toString()}`);
    openBrowser(url.toString());
    return;
  }

  const serverFile = webServerPath();
  if (!serverFile) throw new Error("The packaged web application is missing. Reinstall SkipTheVoice.");
  const host = localHost(url);
  const port = url.port || "3000";
  const selectedSchema = schemaPath();
  const server = spawn(process.execPath, [serverFile], {
    cwd: path.dirname(serverFile),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: host,
      PORT: port,
      ...(selectedSchema ? { SKIPTHEVOICE_SCHEMA_PATH: selectedSchema } : {}),
    },
    stdio: "inherit",
    shell: false,
  });

  try {
    await waitForUi(url, server);
  } catch (error) {
    await stopChild(server);
    throw error;
  }

  console.log(`SkipTheVoice is running at ${url.toString()}`);
  console.log("Press Ctrl+C to stop it.");
  openBrowser(url.toString());

  let managedWorker: ManagedWhisperWorker | undefined;
  const runner = new JobRunner(app.repositories, app.whisper);
  let stopping = false;
  const services = (async () => {
    try {
      managedWorker = await ensureWhisperWorker(app);
      if (stopping) return;
      console.log("Transcription services are ready.");
      await runner.run();
    } catch (error) {
      console.error(`Transcription services could not be started: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  })();

  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    server.once("exit", finish);
  });

  stopping = true;
  runner.stop();
  if (managedWorker) await managedWorker.stop();
  await stopChild(server);
  await services;
}
