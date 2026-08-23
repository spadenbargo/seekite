import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DATASETS, defaultBeirCacheDirectory, loadDataset } from "./datasets.js";
import { ENGINE_ADAPTERS } from "./engines/index.js";
import { evaluateRun, METRIC_DEFINITIONS, ZERO_METRICS } from "./metrics.js";
import {
  calculateMacro,
  collectEnvironment,
  evaluateChecks,
  formatMarkdown,
  readAcceptedResults,
  type BenchmarkReport,
  type DatasetResult,
  type EngineResult,
} from "./report.js";
import {
  CANDIDATE_NAMES,
  DATASET_NAMES,
  ENGINE_NAMES,
  type CandidateName,
  type DatasetName,
  type EngineName,
  type RankedRuns,
} from "./types.js";

const DEFAULT_BUDGET_MS = 5 * 60 * 1_000;
const RETRIEVAL_LIMIT = 100;

export interface CliOptions {
  accepted: string;
  budgetMs: number;
  cacheDirectory: string;
  candidates: CandidateName[];
  check: boolean;
  datasets: DatasetName[];
  engines: EngineName[];
  help: boolean;
  output?: string;
}

function benchmarkRoot(): string {
  return path.resolve(import.meta.dirname, "..");
}

function commaList<Value extends string>(
  flag: string,
  value: string,
  allowed: readonly Value[],
): Value[] {
  const rawValues = [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  if (rawValues.length === 0) throw new Error(`${flag} needs at least one comma-separated value`);
  const values: Value[] = [];
  const invalid: string[] = [];
  for (const entry of rawValues) {
    const allowedValue = allowed.find((candidate) => candidate === entry);
    if (allowedValue === undefined) invalid.push(entry);
    else values.push(allowedValue);
  }
  if (invalid.length > 0) {
    throw new Error(`${flag} contains unsupported value(s): ${invalid.join(", ")}`);
  }
  return values;
}

function argumentValue(arguments_: string[], index: number, flag: string): [string, number] {
  const argument = arguments_[index]!;
  const equals = argument.indexOf("=");
  if (equals >= 0) return [argument.slice(equals + 1), index];
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

export function parseArgs(arguments_: string[]): CliOptions {
  const options: CliOptions = {
    accepted: path.join(benchmarkRoot(), "accepted.json"),
    budgetMs: DEFAULT_BUDGET_MS,
    cacheDirectory: defaultBeirCacheDirectory(),
    candidates: ["lexical"],
    check: false,
    datasets: [...DATASET_NAMES],
    engines: [...ENGINE_NAMES],
    help: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") continue;
    if (argument === "--check") options.check = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--datasets" || argument.startsWith("--datasets=")) {
      const [value, next] = argumentValue(arguments_, index, "--datasets");
      options.datasets = commaList("--datasets", value, DATASET_NAMES);
      index = next;
    } else if (argument === "--engines" || argument.startsWith("--engines=")) {
      const [value, next] = argumentValue(arguments_, index, "--engines");
      options.engines = commaList("--engines", value, ENGINE_NAMES);
      index = next;
    } else if (argument === "--candidates" || argument.startsWith("--candidates=")) {
      const [value, next] = argumentValue(arguments_, index, "--candidates");
      options.candidates = commaList("--candidates", value, CANDIDATE_NAMES);
      index = next;
    } else if (argument === "--out" || argument.startsWith("--out=")) {
      const [value, next] = argumentValue(arguments_, index, "--out");
      options.output = path.resolve(value);
      index = next;
    } else if (argument === "--accepted" || argument.startsWith("--accepted=")) {
      const [value, next] = argumentValue(arguments_, index, "--accepted");
      options.accepted = path.resolve(value);
      index = next;
    } else if (argument === "--cache" || argument.startsWith("--cache=")) {
      const [value, next] = argumentValue(arguments_, index, "--cache");
      options.cacheDirectory = path.resolve(value);
      index = next;
    } else if (argument === "--budget-ms" || argument.startsWith("--budget-ms=")) {
      const [value, next] = argumentValue(arguments_, index, "--budget-ms");
      const budgetMs = Number(value);
      if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
        throw new Error("--budget-ms must be a positive finite number");
      }
      options.budgetMs = Math.floor(budgetMs);
      index = next;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export const HELP = `Usage: pnpm --filter @seekite/bench-beir run bench -- [options]

Options:
  --datasets <list>    scifact,nfcorpus,arguana (default: all)
  --engines <list>     seekite,zbsearch,orama,minisearch (default: all)
  --candidates <list>  lexical,hybrid (default: lexical)
  --out <path>         JSON file or output directory (default: results/<date>-<host>.json)
  --cache <directory>  Dataset/cache directory (default: <repo>/.cache/beir)
  --accepted <file>    Reviewed regression baseline (default: accepted.json)
  --budget-ms <number> Per-engine query budget (default: 300000)
  --check              Enforce Seekite sanity and accepted-result regression gates
  --help               Show this help

The Markdown report is written beside the JSON report with a .md extension.
Hybrid is supported by Seekite only and embeds documents locally; CI should use lexical.`;

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "host";
}

export function resolveOutputFiles(
  output: string | undefined,
  createdAt: string,
): {
  json: string;
  markdown: string;
} {
  const generatedName = `${createdAt.slice(0, 10)}-${safeSegment(hostname())}.json`;
  const requested = output ?? path.join(benchmarkRoot(), "results", generatedName);
  const json =
    path.extname(requested).toLowerCase() === ".json"
      ? requested
      : path.join(requested, generatedName);
  return { json, markdown: json.replace(/\.json$/i, ".md") };
}

async function writeReport(
  report: BenchmarkReport,
  files: { json: string; markdown: string },
): Promise<void> {
  await Promise.all([
    mkdir(path.dirname(files.json), { recursive: true }),
    mkdir(path.dirname(files.markdown), { recursive: true }),
  ]);
  report.macro = calculateMacro(report.datasets);
  await Promise.all([
    writeFile(files.json, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(files.markdown, formatMarkdown(report)),
  ]);
}

class BudgetExceededError extends Error {}

async function withinBudget<Value>(operation: Promise<Value>, remainingMs: number): Promise<Value> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new BudgetExceededError("query budget exceeded")), remainingMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runEngine(
  dataset: Awaited<ReturnType<typeof loadDataset>>,
  engine: EngineName,
  candidate: CandidateName,
  options: CliOptions,
): Promise<EngineResult> {
  const adapter = ENGINE_ADAPTERS[engine];
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), `seekite-beir-${dataset.name}-${engine}-${candidate}-`),
  );
  let built: Awaited<ReturnType<typeof adapter.build>> | undefined;
  let buildSeconds = 0;
  try {
    const buildStarted = performance.now();
    built = await adapter.build(dataset.documents, {
      cacheDirectory: options.cacheDirectory,
      candidate,
      dataset: dataset.name,
      temporaryDirectory,
    });
    buildSeconds = (performance.now() - buildStarted) / 1_000;

    const knownDocuments = new Set(dataset.documents.map((document) => document.id));
    const runs: RankedRuns = new Map();
    const queryStarted = performance.now();
    let completedQueries = 0;
    let budgetExceeded = false;
    for (const query of dataset.queries) {
      const elapsed = performance.now() - queryStarted;
      const remaining = options.budgetMs - elapsed;
      if (remaining <= 0) {
        budgetExceeded = true;
        break;
      }
      try {
        // eslint-disable-next-line no-await-in-loop -- latency is measured without query contention
        const hits = await withinBudget(built.search(query.text, RETRIEVAL_LIMIT), remaining);
        const unknown = hits.find((documentId) => !knownDocuments.has(documentId));
        if (unknown)
          throw new Error(`${adapter.label} returned unknown BEIR document id ${unknown}`);
        if (new Set(hits).size !== hits.length) {
          throw new Error(`${adapter.label} returned duplicate BEIR document ids`);
        }
        runs.set(query.id, hits);
        completedQueries += 1;
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          budgetExceeded = true;
          break;
        }
        throw error;
      }
    }
    const queryMilliseconds = performance.now() - queryStarted;
    const key = `${engine}-${candidate}`;
    return {
      candidate,
      engine,
      key,
      label: `${adapter.label} (${candidate})`,
      metrics: budgetExceeded ? { ...ZERO_METRICS } : evaluateRun(runs, dataset.qrels),
      timing: {
        budgetMs: options.budgetMs,
        buildSeconds,
        completedQueries,
        msPerQuery: budgetExceeded ? null : queryMilliseconds / dataset.queries.length,
        queryMilliseconds,
        queries: dataset.queries.length,
        status: budgetExceeded ? "budget-exceeded" : "completed",
      },
    };
  } finally {
    await built?.dispose?.();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function runBenchmark(options: CliOptions): Promise<{
  files: { json: string; markdown: string };
  report: BenchmarkReport;
}> {
  const combinations = options.engines.flatMap((engine) =>
    options.candidates
      .filter((candidate) => ENGINE_ADAPTERS[engine].candidates.includes(candidate))
      .map((candidate) => ({ candidate, engine })),
  );
  if (combinations.length === 0) {
    throw new Error("No selected engine supports any selected candidate");
  }
  if (
    options.check &&
    !combinations.some(({ candidate, engine }) => engine === "seekite" && candidate === "lexical")
  ) {
    throw new Error("--check requires --engines seekite and --candidates lexical");
  }

  const createdAt = new Date().toISOString();
  const files = resolveOutputFiles(options.output, createdAt);
  const report: BenchmarkReport = {
    benchmark: "beir-search-quality",
    createdAt,
    datasets: {},
    engineBudgetMs: options.budgetMs,
    environment: await collectEnvironment(),
    macro: {},
    metricDefinitions: { ...METRIC_DEFINITIONS },
    retrievalLimit: RETRIEVAL_LIMIT,
    selection: {
      candidates: options.candidates,
      datasets: options.datasets,
      engines: options.engines,
    },
    version: 1,
  };
  await writeReport(report, files);

  for (const datasetName of options.datasets) {
    console.log(`\nLoading ${datasetName} ...`);
    // eslint-disable-next-line no-await-in-loop -- datasets are intentionally isolated
    const dataset = await loadDataset(datasetName, { cacheDirectory: options.cacheDirectory });
    const definition = DATASETS[datasetName];
    const datasetResult: DatasetResult = {
      archive: { bytes: definition.archiveBytes, sha256: definition.sha256 },
      documents: dataset.documents.length,
      engines: {},
      queries: dataset.queries.length,
      referenceBm25Ndcg10: definition.referenceNdcg10,
    };
    report.datasets[datasetName] = datasetResult;
    for (const combination of combinations) {
      const key = `${combination.engine}-${combination.candidate}`;
      console.log(`Running ${datasetName}: ${key} ...`);
      // eslint-disable-next-line no-await-in-loop -- engines share a process but not measurement windows
      const result = await runEngine(dataset, combination.engine, combination.candidate, options);
      datasetResult.engines[key] = result;
      console.log(
        result.timing.status === "completed"
          ? `  nDCG@10 ${result.metrics.ndcg10.toFixed(3)}; ${result.timing.msPerQuery!.toFixed(2)} ms/query`
          : `  budget exceeded after ${result.timing.completedQueries}/${result.timing.queries} queries; scored 0`,
      );
      // Preserve completed work if a later engine or dataset fails.
      // eslint-disable-next-line no-await-in-loop -- report order follows benchmark order
      await writeReport(report, files);
    }
  }

  if (options.check) {
    report.checks = evaluateChecks(report, await readAcceptedResults(options.accepted));
    if (report.checks.regression === "not-evaluated") {
      console.warn(
        "accepted.json has no reviewed measurements; --check enforced the Lucene sanity band but did not evaluate regression",
      );
    }
  }
  await writeReport(report, files);
  return { files, report };
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(HELP);
      return;
    }
    const outcome = await runBenchmark(options);
    console.log(`\nJSON: ${outcome.files.json}`);
    console.log(`Markdown: ${outcome.files.markdown}`);
    if (outcome.report.checks && !outcome.report.checks.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
