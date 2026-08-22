#!/usr/bin/env node
import path from "node:path";
import {
  buildSearch,
  clearEmbeddingCache,
  getEmbeddingCacheStats,
  pruneEmbeddingCache,
} from "@seekite/build";
import { cac } from "cac";
import chokidar from "chokidar";
import { formatByteSize, parseByteSize } from "./bytes.js";
import { loadSearchConfig } from "./config.js";
import { parseIndexFormat } from "./format.js";

interface CommandOptions {
  config?: string;
  root?: string;
  output?: string;
  cache?: boolean;
  format?: string | number;
}

interface BenchCommandOptions extends CommandOptions {
  compare?: boolean;
  baseline?: string;
  tolerance?: string;
  label?: string;
  cold?: boolean;
  writeBaseline?: string;
}

interface LabCommandOptions extends CommandOptions {
  host?: string;
  port?: string;
  open?: boolean;
}

interface CacheCommandOptions {
  root?: string;
  maxSize?: string;
  provider?: string;
}

async function runBuild(options: CommandOptions): Promise<void> {
  const root = path.resolve(options.root ?? process.cwd());
  const config = await loadSearchConfig(root, options.config);
  const result = await buildSearch(config, {
    root,
    outputDir: options.output,
    cache: options.cache,
    format: parseIndexFormat(options.format),
  });
  const summary = Object.entries(result.corpora)
    .map(([name, counts]) =>
      counts.embedded === undefined
        ? `${name}: ${counts.documents} documents, ${counts.chunks} chunks`
        : `${name}: ${counts.chunks} chunks, ${counts.cached ?? 0} cached, ${counts.embedded} embedded (${((counts.durationMs ?? 0) / 1_000).toFixed(1)}s)`,
    )
    .join("; ");
  console.log(`Seekite wrote ${result.outputDir} (${summary})`);
}

async function loadLab() {
  try {
    return await import("@seekite/lab");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new Error(
        "The bench and lab commands require @seekite/lab. Install it with `pnpm add -D @seekite/lab`.",
        { cause: error },
      );
    }
    throw error;
  }
}

async function detectEmbeddingBackend(): Promise<"native" | "wasm"> {
  try {
    const native = await import("@seekite/engine-native");
    return native.isSupported() ? "native" : "wasm";
  } catch {
    return "wasm";
  }
}

async function runBench(runFiles: string[], options: BenchCommandOptions): Promise<void> {
  const root = path.resolve(options.root ?? process.cwd());
  const lab = await loadLab();
  const tolerance = options.tolerance === undefined ? 0.01 : Number(options.tolerance);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("--tolerance must be a non-negative number");
  }
  if (options.compare || runFiles.length > 0) {
    if (runFiles.length !== 2) throw new Error("Run comparison requires exactly two run files");
    const comparison = lab.compareRuns(
      await lab.readRun(path.resolve(root, runFiles[0]!)),
      await lab.readRun(path.resolve(root, runFiles[1]!)),
      tolerance,
    );
    console.log(lab.formatComparison(comparison));
    if (!comparison.passed) process.exitCode = 1;
    return;
  }
  const config = await loadSearchConfig(root, options.config);
  const outcome = await lab.bench(config, {
    root,
    label: options.label,
    cold: options.cold,
    backend: await detectEmbeddingBackend(),
    quiet: true,
  });
  console.log(lab.formatRun(outcome.run));
  console.log(`Seekite wrote benchmark run ${outcome.file}`);
  if (options.writeBaseline) {
    const baseline = await lab.writeBaseline(
      outcome.run,
      path.resolve(root, options.writeBaseline),
      options.label ? `${options.label}-baseline` : "baseline",
    );
    console.log(`Seekite wrote deterministic baseline ${baseline}`);
  }
  if (options.baseline) {
    const comparison = lab.compareRuns(
      await lab.readRun(path.resolve(root, options.baseline)),
      outcome.run,
      tolerance,
    );
    console.log(lab.formatComparison(comparison));
    if (!comparison.passed) process.exitCode = 1;
  }
}

async function runLab(options: LabCommandOptions): Promise<void> {
  const root = path.resolve(options.root ?? process.cwd());
  const config = await loadSearchConfig(root, options.config);
  const port = options.port === undefined ? undefined : Number(options.port);
  if (port !== undefined && (!Number.isSafeInteger(port) || port < 0 || port > 65_535)) {
    throw new Error("--port must be between 0 and 65535");
  }
  const lab = await loadLab();
  const server = await lab.serveLab({
    root,
    config,
    host: options.host,
    port,
    open: options.open,
  });
  console.log(`Seekite lab is running at ${server.url}`);
}

async function runCacheCommand(action: string, options: CacheCommandOptions): Promise<void> {
  const root = path.resolve(options.root ?? process.cwd());
  if (action === "stats") {
    const stats = await getEmbeddingCacheStats({ root });
    if (stats.providers.length === 0) {
      console.log(`Seekite embedding cache is empty (${stats.directory})`);
      return;
    }
    for (const provider of stats.providers) {
      console.log(
        `${provider.provider}: ${provider.entries} entries, ${formatByteSize(provider.bytes)}, last used ${provider.lastUsed ?? "never"}`,
      );
    }
    console.log(
      `Total: ${stats.entries} entries, ${formatByteSize(stats.bytes)} (${stats.directory})`,
    );
    return;
  }
  if (action === "prune") {
    const result = await pruneEmbeddingCache({
      root,
      maxSize: options.maxSize ? parseByteSize(options.maxSize) : undefined,
    });
    console.log(
      `Seekite pruned ${result.entriesRemoved} entries and ${formatByteSize(result.bytesBefore - result.bytesAfter)} (${formatByteSize(result.bytesAfter)} remain)`,
    );
    return;
  }
  if (action === "clear") {
    const result = await clearEmbeddingCache({ root, provider: options.provider });
    console.log(
      `Seekite cleared ${result.providersRemoved} provider${result.providersRemoved === 1 ? "" : "s"} and ${formatByteSize(result.bytesRemoved)}`,
    );
    return;
  }
  throw new Error(
    `Unknown cache command ${JSON.stringify(action)}; expected stats, prune, or clear`,
  );
}

const cli = cac("seekite");

cli
  .command("build", "Build all configured search corpora")
  .option("--config <file>", "Configuration file", { default: "search.config.ts" })
  .option("--root <directory>", "Project root")
  .option("--output <directory>", "Override the output directory")
  .option("--format <version>", "Index format to write (1 or 2)")
  .option("--no-cache", "Bypass cache reads while still warming the cache")
  .action(runBuild);

cli
  .command("dev", "Build and watch local source files")
  .option("--config <file>", "Configuration file", { default: "search.config.ts" })
  .option("--root <directory>", "Project root")
  .option("--output <directory>", "Override the output directory")
  .option("--format <version>", "Index format to write (1 or 2)")
  .option("--no-cache", "Bypass cache reads while still warming the cache")
  .action(async (options: CommandOptions) => {
    const root = path.resolve(options.root ?? process.cwd());
    let building = false;
    let pending = false;
    const rebuild = async () => {
      if (building) {
        pending = true;
        return;
      }
      building = true;
      try {
        await runBuild(options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      } finally {
        building = false;
        if (pending) {
          pending = false;
          void rebuild();
        }
      }
    };
    await rebuild();
    chokidar
      .watch(root, {
        ignored: [/(^|[/\\])\../, /node_modules/, /dist/, /public[/\\]search/],
        ignoreInitial: true,
      })
      .on("all", () => void rebuild());
    console.log(`Seekite is watching ${root}`);
  });

cli
  .command("cache <action>", "Inspect, prune, or clear the embedding cache")
  .option("--root <directory>", "Project root")
  .option("--max-size <size>", "Evict oldest entries until the cache fits (for example 500MB)")
  .option("--provider <id>", "Only clear this provider")
  .action(runCacheCommand);

cli
  .command("bench [...runs]", "Benchmark candidates or compare two saved runs")
  .option("--config <file>", "Configuration file", { default: "search.config.ts" })
  .option("--root <directory>", "Project root")
  .option("--label <label>", "Label stored in the run file")
  .option("--cold", "Bypass embedding-cache reads")
  .option("--compare", "Compare the two positional run files")
  .option("--baseline <file>", "Compare a new run to this baseline")
  .option("--write-baseline <file>", "Write a deterministic baseline from the new run")
  .option("--tolerance <value>", "Allowed NDCG regression", { default: "0.01" })
  .action(runBench);

cli
  .command("lab", "Open the local benchmark inspector")
  .option("--config <file>", "Configuration file", { default: "search.config.ts" })
  .option("--root <directory>", "Project root")
  .option("--host <host>", "Listen host", { default: "127.0.0.1" })
  .option("--port <port>", "Listen port", { default: "4178" })
  .option("--open", "Open the lab in your browser")
  .action(runLab);

cli.help();
cli.version("0.1.0-alpha.0");
cli.parse();
