import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const sourceRoot = path.join(repositoryRoot, "apps", "whisper-worker");
const destinationRoot = path.join(packageRoot, "dist", "worker");

rmSync(destinationRoot, { recursive: true, force: true });
mkdirSync(destinationRoot, { recursive: true });
cpSync(path.join(sourceRoot, "app"), path.join(destinationRoot, "app"), {
  recursive: true,
  filter: (source) => !source.includes("__pycache__") && !source.includes(`${path.sep}tests${path.sep}`),
});
cpSync(path.join(sourceRoot, "requirements-runtime.txt"), path.join(destinationRoot, "requirements.txt"));
