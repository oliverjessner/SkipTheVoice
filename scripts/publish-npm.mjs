#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const shouldPublish = process.argv.includes("--publish");
const skipChecks = process.argv.includes("--skip-checks");
const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  console.log(`\n> ${printable}`);
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${printable} exited with status ${result.status}.`);
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

run("npm", ["whoami"]);
const publishArguments = ["publish", "--workspace", "skipthevoice", "--access", "public", "--tag", valueAfter("--tag") ?? "latest"];
const otp = valueAfter("--otp");
if (otp) publishArguments.push("--otp", otp);
run("npm", publishArguments);
run("node", ["scripts/update-homebrew-formula.mjs", "--tap", valueAfter("--tap") ?? "../homebrew-tap"]);
console.log("\nThe npm package is published and the local Homebrew formula is updated. Review, commit, and push the tap separately.");
