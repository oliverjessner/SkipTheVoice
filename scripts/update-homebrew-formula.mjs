#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argumentsMap = new Map();
for (let index = 2; index < process.argv.length; index += 2) argumentsMap.set(process.argv[index], process.argv[index + 1]);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "packages", "cli", "package.json"), "utf8"));
const version = argumentsMap.get("--version") ?? manifest.version;
const requestedTap = argumentsMap.get("--tap");
const tap = requestedTap ? path.resolve(repositoryRoot, requestedTap) : (() => {
  const result = spawnSync("brew", ["--repo", argumentsMap.get("--brew-tap") ?? "oliverjessner/tap"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not locate the Homebrew tap: ${result.stderr.trim()}`);
  return result.stdout.trim();
})();
const formulaPath = path.join(tap, "Formula", "skipthevoice.rb");
const registryUrl = `https://registry.npmjs.org/skipthevoice/-/skipthevoice-${version}.tgz`;

if (!existsSync(formulaPath)) throw new Error(`Homebrew formula not found: ${formulaPath}`);

let archive;
const localTarball = argumentsMap.get("--tarball");
if (localTarball) {
  archive = readFileSync(path.resolve(repositoryRoot, localTarball));
} else {
  let response;
  for (let attempt = 0; attempt < 12; attempt++) {
    response = await fetch(registryUrl);
    if (response.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!response?.ok) throw new Error(`Could not download the published package: ${response?.status ?? "unknown error"}`);
  archive = Buffer.from(await response.arrayBuffer());
}

const sha256 = createHash("sha256").update(archive).digest("hex");
const existingFormula = readFileSync(formulaPath, "utf8");
const existingVersion = existingFormula.match(/skipthevoice-([^/\"]+)\.tgz/)?.[1];
if (!existingVersion) throw new Error(`Could not determine the current version in ${formulaPath}.`);

let formula = existingFormula
  .replace(/^  url ".*"$/m, `  url "${registryUrl}"`)
  .replace(/^  sha256 ".*"$/m, `  sha256 "${sha256}"`);
if (existingVersion !== version) formula = formula.replace(/^  revision \d+\n/m, "");
writeFileSync(formulaPath, formula);
console.log(`Updated ${formulaPath} to skipthevoice ${version} (${sha256}).`);
