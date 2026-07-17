#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const shouldPublish = process.argv.includes("--publish");
const skipChecks = process.argv.includes("--skip-checks");
const skipBrewInstall = process.argv.includes("--skip-brew-install");
const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const brewFormula = valueAfter("--brew-formula") ?? "oliverjessner/tap/skipthevoice";
const brewTap = brewFormula.split("/").slice(0, 2).join("/");
const rootManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "packages", "cli", "package.json"), "utf8"));
let tap;
let formulaPath;

function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  console.log(`\n> ${printable}`);
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${printable} exited with status ${result.status}.`);
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${[command, ...args].join(" ")} exited with status ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function assertCleanTap() {
  const changes = capture("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: tap });
  if (changes) throw new Error(`The Homebrew tap has uncommitted changes:\n${changes}\nCommit or discard them before publishing.`);
}

if (rootManifest.version !== packageManifest.version) {
  throw new Error(`Version mismatch: package.json is ${rootManifest.version}, packages/cli/package.json is ${packageManifest.version}.`);
}

if (!skipChecks) {
  run("npm", ["test"]);
  run("npm", ["run", "lint"]);
  run("npm", ["run", "typecheck"]);
}
run("npm", ["pack", "--dry-run", "--workspace", "skipthevoice"]);

if (!shouldPublish) {
  console.log("\nRelease check passed. Nothing was published. Run `npm run publish:npm -- --publish` to publish.");
  process.exit(0);
}

run("brew", ["--version"]);
tap = capture("brew", ["--repo", brewTap]);
formulaPath = path.join(tap, "Formula", "skipthevoice.rb");
if (!existsSync(formulaPath)) throw new Error(`Homebrew formula not found: ${formulaPath}`);
capture("git", ["rev-parse", "--is-inside-work-tree"], { cwd: tap });
assertCleanTap();
run("git", ["pull", "--ff-only"], { cwd: tap });
assertCleanTap();
run("git", ["push", "--dry-run"], { cwd: tap });
run("brew", ["style", formulaPath]);
run("brew", ["audit", "--strict", brewFormula]);
run("npm", ["whoami"]);
const publishedVersionResult = JSON.parse(capture("npm", ["view", packageManifest.name, "versions", "--json"]));
const publishedVersions = Array.isArray(publishedVersionResult) ? publishedVersionResult : [publishedVersionResult];
if (publishedVersions.includes(packageManifest.version)) {
  throw new Error(`${packageManifest.name}@${packageManifest.version} has already been published. Increase the version before releasing.`);
}
const publishArguments = ["publish", "--workspace", "skipthevoice", "--access", "public", "--tag", valueAfter("--tag") ?? "latest"];
const otp = valueAfter("--otp");
if (otp) publishArguments.push("--otp", otp);
run("npm", publishArguments);
run("node", ["scripts/update-homebrew-formula.mjs", "--tap", tap]);
run("brew", ["style", formulaPath]);
run("brew", ["audit", "--strict", brewFormula]);

if (!skipBrewInstall) {
  const installed = spawnSync("brew", ["list", "--versions", brewFormula], { stdio: "ignore" }).status === 0;
  run("brew", [installed ? "reinstall" : "install", "--build-from-source", brewFormula]);
  run("brew", ["test", brewFormula]);
}

run("git", ["add", "--", "Formula/skipthevoice.rb"], { cwd: tap });
if (!capture("git", ["diff", "--cached", "--name-only", "--", "Formula/skipthevoice.rb"], { cwd: tap })) {
  throw new Error("The Homebrew formula did not change after npm publication.");
}
run("git", ["commit", "-m", `Update skipthevoice to ${packageManifest.version}`], { cwd: tap });
run("git", ["push"], { cwd: tap });
run("brew", ["update"]);
run("brew", ["audit", "--strict", brewFormula]);
console.log(`\nPublished skipthevoice ${packageManifest.version} to npm and Homebrew, including installation and formula tests.`);
