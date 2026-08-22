#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runNextBuild, type SeekiteNextBuildOptions } from "./index.js";

const HELP = `Usage: seekite-next build [options]

Options:
  --root <dir>         Next project root
  --config <file>      Seekite config path
  --html-dir <dir>     Explicit rendered HTML directory
  --out-dir <dir>      Explicit search artifact directory
  --assets-dir <name>  Asset directory (default: search)
  --next-server        Allow best-effort .next/server/app indexing
  --help               Show this help`;

function optionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseNextBuildArgs(args: string[]): SeekiteNextBuildOptions | "help" {
  if (args[0] === "--help" || args[0] === "-h") return "help";
  if (args[0] !== "build") throw new Error("Expected the `build` command");
  const options: SeekiteNextBuildOptions = {};
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) throw new Error("Unexpected empty argument");
    if (argument === "--help" || argument === "-h") return "help";
    if (argument === "--next-server") {
      options.includeNextServer = true;
      continue;
    }
    const value = optionValue(args, index, argument);
    if (argument === "--root") options.root = value;
    else if (argument === "--config") options.config = value;
    else if (argument === "--html-dir") options.htmlDir = value;
    else if (argument === "--out-dir") options.outDir = value;
    else if (argument === "--assets-dir") options.assetsDir = value;
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }
  return options;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseNextBuildArgs(args);
  if (options === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await runNextBuild(options);
  process.stdout.write(`Seekite indexed Next ${result.mode} HTML into ${result.outputDir}\n`);
}

if (
  process.argv[1] &&
  realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
