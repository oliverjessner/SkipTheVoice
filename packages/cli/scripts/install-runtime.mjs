#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requirements = path.join(packageRoot, "dist", "worker", "requirements.txt");
const checkOnly = process.argv.includes("--check");

function userDataRoot() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "SkipTheVoice");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? os.homedir(), "SkipTheVoice");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "skipthevoice");
}

function isWorkspaceInstall() {
  const manifestPath = path.resolve(packageRoot, "../..", "package.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return manifest.name === "skipthevoice-monorepo" && Array.isArray(manifest.workspaces);
  } catch {
    return false;
  }
}

function pythonVersion(command) {
  const result = spawnSync(command, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const [major, minor] = result.stdout.trim().split(".").map(Number);
  return major === 3 && minor >= 11 && minor <= 14 ? { command, major, minor } : undefined;
}

function findPython() {
  const candidates = [process.env.SKIPTHEVOICE_PYTHON, "python3.13", "python3.12", "python3.11", "python3", "python"].filter(Boolean);
  for (const command of candidates) {
    const match = pythonVersion(command);
    if (match) return match;
  }
  throw new Error("Python 3.11 through 3.14 is required. Install Python and run this installation again.");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

if (process.env.SKIPTHEVOICE_SKIP_RUNTIME_INSTALL === "1" || isWorkspaceInstall()) {
  console.log("SkipTheVoice: local Whisper runtime setup skipped.");
  process.exit(0);
}
if (!existsSync(requirements)) throw new Error("The packaged Whisper runtime requirements are missing.");

const python = findPython();
if (checkOnly) {
  console.log(`SkipTheVoice runtime prerequisites are available (Python ${python.major}.${python.minor}).`);
  process.exit(0);
}

const runtimeRoot = process.env.SKIPTHEVOICE_RUNTIME_DIRECTORY ?? path.join(userDataRoot(), "runtime");
const venv = path.join(runtimeRoot, "whisper-venv");
const venvPython = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
const digest = createHash("sha256").update(readFileSync(requirements)).digest("hex");
const stamp = path.join(runtimeRoot, "requirements.sha256");
mkdirSync(runtimeRoot, { recursive: true });

if (!existsSync(venvPython)) run(python.command, ["-m", "venv", venv]);
if (!existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== digest) {
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "pip"]);
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", requirements]);
  writeFileSync(stamp, `${digest}\n`);
}
console.log(`SkipTheVoice: local Whisper runtime is ready in ${venv}.`);
