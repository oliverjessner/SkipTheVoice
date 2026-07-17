import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const webRoot = path.join(repositoryRoot, "apps", "web");
const standaloneRoot = path.join(webRoot, ".next", "standalone", "apps", "web");
const staticRoot = path.join(webRoot, ".next", "static");
const publicRoot = path.join(webRoot, "public");
const destinationRoot = path.join(packageRoot, "dist", "web");

if (!existsSync(path.join(standaloneRoot, "server.js"))) {
  throw new Error("The standalone web build is missing. Run the web build before packaging the CLI.");
}

rmSync(destinationRoot, { recursive: true, force: true });
mkdirSync(destinationRoot, { recursive: true });
cpSync(standaloneRoot, destinationRoot, { recursive: true, verbatimSymlinks: true });
cpSync(staticRoot, path.join(destinationRoot, ".next", "static"), { recursive: true });
if (existsSync(publicRoot)) cpSync(publicRoot, path.join(destinationRoot, "public"), { recursive: true });

for (const developmentFile of ["e2e", "src", "next-env.d.ts", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "tsconfig.tsbuildinfo"]) {
  rmSync(path.join(destinationRoot, developmentFile), { recursive: true, force: true });
}

function replaceExternalAliases(directory) {
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    if (lstatSync(entryPath).isSymbolicLink()) {
      const target = readlinkSync(entryPath);
      const packageName = target.split("node_modules/").at(-1);
      if (!packageName) throw new Error(`Could not determine the external package for ${entryPath}.`);
      rmSync(entryPath);
      mkdirSync(entryPath);
      if (packageName === "@whiskeysockets/baileys") {
        writeFileSync(path.join(entryPath, "package.json"), `${JSON.stringify({ type: "module", main: "index.js", exports: "./index.js" })}\n`);
        writeFileSync(path.join(entryPath, "index.js"), `export * from ${JSON.stringify(packageName)};\nexport { default } from ${JSON.stringify(packageName)};\n`);
        continue;
      }
      writeFileSync(path.join(entryPath, "package.json"), `${JSON.stringify({ type: "commonjs", main: "index.cjs" })}\n`);
      writeFileSync(path.join(entryPath, "index.cjs"), `module.exports = require(${JSON.stringify(packageName)});\n`);
      continue;
    }
    if (lstatSync(entryPath).isDirectory()) replaceExternalAliases(entryPath);
  }
}

replaceExternalAliases(path.join(destinationRoot, ".next", "node_modules"));
