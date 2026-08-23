import { execFile } from "node:child_process";
import { cpus, freemem, hostname, platform, release, totalmem } from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DATASETS } from "./datasets.js";
import type { CandidateName, DatasetName, EngineName, QualityMetrics } from "./types.js";

const execFileAsync = promisify(execFile);

export interface EngineTiming {
  budgetMs: number;
  buildSeconds: number;
  completedQueries: number;
  msPerQuery: number | null;
  queryMilliseconds: number;
  queries: number;
  status: "completed" | "budget-exceeded";
}

export interface EngineResult {
  candidate: CandidateName;
  engine: EngineName;
  key: string;
  label: string;
  metrics: QualityMetrics;
  timing: EngineTiming;
}

export interface DatasetResult {
  archive: { bytes: number; sha256: string };
  documents: number;
  engines: Record<string, EngineResult>;
  queries: number;
  referenceBm25Ndcg10: number;
}

export interface MacroResult {
  datasets: number;
  label: string;
  metrics: QualityMetrics;
  msPerQuery: number | null;
}

export interface BenchmarkEnvironment {
  cpu: { cores: number; model: string };
  git: { dirty: boolean | null; revision: string | null };
  host: string;
  memory: { freeBytesAtStart: number; totalBytes: number };
  node: string;
  packages: Record<string, string>;
  platform: string;
  v8: string;
}

export interface CheckIssue {
  actual?: number;
  baseline?: number;
  dataset: DatasetName;
  engine: string;
  kind: "missing-seekite-result" | "sanity" | "regression";
  minimum?: number;
}

export interface CheckResult {
  issues: CheckIssue[];
  passed: boolean;
  regression: "passed" | "failed" | "not-evaluated";
  regressionTolerance: number;
  sanity: "passed" | "failed";
  sanityTolerance: number;
}

export interface BenchmarkReport {
  benchmark: "beir-search-quality";
  checks?: CheckResult;
  createdAt: string;
  datasets: Partial<Record<DatasetName, DatasetResult>>;
  engineBudgetMs: number;
  environment: BenchmarkEnvironment;
  macro: Record<string, MacroResult>;
  metricDefinitions: Record<keyof QualityMetrics, string>;
  retrievalLimit: number;
  selection: {
    candidates: CandidateName[];
    datasets: DatasetName[];
    engines: EngineName[];
  };
  version: 1;
}

export interface AcceptedResults {
  acceptedAt: string | null;
  datasets: Partial<Record<DatasetName, Record<string, { ndcg10: number }>>>;
  regressionTolerance: number;
  version: 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateMacro(datasets: BenchmarkReport["datasets"]): Record<string, MacroResult> {
  const rows = new Map<string, Array<{ result: EngineResult; queries: number }>>();
  for (const dataset of Object.values(datasets)) {
    for (const result of Object.values(dataset.engines)) {
      const entries = rows.get(result.key) ?? [];
      entries.push({ result, queries: dataset.queries });
      rows.set(result.key, entries);
    }
  }

  return Object.fromEntries(
    [...rows].map(([key, entries]) => {
      const completed = entries.filter(({ result }) => result.timing.msPerQuery !== null);
      const timedQueries = completed.reduce((sum, entry) => sum + entry.queries, 0);
      const queryMilliseconds = completed.reduce(
        (sum, { result }) => sum + result.timing.queryMilliseconds,
        0,
      );
      return [
        key,
        {
          datasets: entries.length,
          label: entries[0]!.result.label,
          metrics: {
            ndcg10: mean(entries.map(({ result }) => result.metrics.ndcg10)),
            map100: mean(entries.map(({ result }) => result.metrics.map100)),
            recall100: mean(entries.map(({ result }) => result.metrics.recall100)),
            precision10: mean(entries.map(({ result }) => result.metrics.precision10)),
            mrr10: mean(entries.map(({ result }) => result.metrics.mrr10)),
          },
          msPerQuery: timedQueries === 0 ? null : queryMilliseconds / timedQueries,
        },
      ];
    }),
  );
}

function formatMetric(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

function formatLatency(value: number | null): string {
  return value === null ? "budget exceeded" : value.toFixed(2);
}

function markdownLabel(value: string): string {
  return value.replaceAll("|", "\\|");
}

export function formatMarkdown(report: BenchmarkReport): string {
  const output = [
    "# Seekite BEIR search-quality benchmark",
    "",
    `Generated ${report.createdAt} on ${report.environment.host}; Node ${report.environment.node}; ${report.environment.platform}; ${report.environment.cpu.model}.`,
    "",
  ];
  for (const datasetName of report.selection.datasets) {
    const dataset = report.datasets[datasetName];
    if (!dataset) continue;
    output.push(
      `## ${datasetName}`,
      "",
      `Lucene BM25 multifield reference nDCG@10: ${dataset.referenceBm25Ndcg10.toFixed(3)}.`,
      "",
      "| Engine | nDCG@10 | MAP@100 | R@100 | P@10 | MRR@10 | Build (s) | ms/query |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const result of Object.values(dataset.engines)) {
      output.push(
        `| ${markdownLabel(result.label)} | ${formatMetric(result.metrics.ndcg10)} | ${formatMetric(result.metrics.map100)} | ${formatMetric(result.metrics.recall100)} | ${formatMetric(result.metrics.precision10)} | ${formatMetric(result.metrics.mrr10)} | ${result.timing.buildSeconds.toFixed(2)} | ${formatLatency(result.timing.msPerQuery)} |`,
      );
    }
    output.push("");
  }

  output.push(
    "## Macro average across selected datasets",
    "",
    "| Engine | Datasets | nDCG@10 | MAP@100 | R@100 | P@10 | MRR@10 | ms/query |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const result of Object.values(report.macro)) {
    output.push(
      `| ${markdownLabel(result.label)} | ${result.datasets} | ${formatMetric(result.metrics.ndcg10)} | ${formatMetric(result.metrics.map100)} | ${formatMetric(result.metrics.recall100)} | ${formatMetric(result.metrics.precision10)} | ${formatMetric(result.metrics.mrr10)} | ${formatLatency(result.msPerQuery)} |`,
    );
  }
  output.push("");
  if (report.checks) {
    output.push(
      "## Checks",
      "",
      `Sanity: ${report.checks.sanity}; regression: ${report.checks.regression}; overall: ${report.checks.passed ? "passed" : "failed"}.`,
      "",
    );
    for (const issue of report.checks.issues) {
      output.push(
        `- ${issue.kind}: ${issue.dataset}/${issue.engine} (actual ${issue.actual?.toFixed(3) ?? "missing"}${issue.minimum === undefined ? "" : `, minimum ${issue.minimum.toFixed(3)}`})`,
      );
    }
    if (report.checks.regression === "not-evaluated") {
      output.push(
        "- Regression comparison was not evaluated because `accepted.json` has no reviewed measurements yet.",
      );
    }
    output.push("");
  }
  return `${output.join("\n").trimEnd()}\n`;
}

export function evaluateChecks(
  report: BenchmarkReport,
  accepted: AcceptedResults,
  sanityTolerance = 0.15,
): CheckResult {
  const issues: CheckIssue[] = [];
  for (const datasetName of report.selection.datasets) {
    const dataset = report.datasets[datasetName];
    const seekite = dataset?.engines["seekite-lexical"];
    if (!seekite || seekite.timing.status !== "completed") {
      issues.push({
        dataset: datasetName,
        engine: "seekite-lexical",
        kind: "missing-seekite-result",
      });
      continue;
    }
    const minimum = DATASETS[datasetName].referenceNdcg10 - sanityTolerance;
    if (seekite.metrics.ndcg10 < minimum) {
      issues.push({
        actual: seekite.metrics.ndcg10,
        dataset: datasetName,
        engine: "seekite-lexical",
        kind: "sanity",
        minimum,
      });
    }
  }

  let comparisons = 0;
  for (const datasetName of report.selection.datasets) {
    const current = report.datasets[datasetName];
    const baseline = accepted.datasets[datasetName];
    if (!current || !baseline) continue;
    for (const [engine, acceptedMetrics] of Object.entries(baseline)) {
      const result = current.engines[engine];
      if (!result) continue;
      comparisons += 1;
      const minimum = acceptedMetrics.ndcg10 - accepted.regressionTolerance;
      if (result.metrics.ndcg10 < minimum) {
        issues.push({
          actual: result.metrics.ndcg10,
          baseline: acceptedMetrics.ndcg10,
          dataset: datasetName,
          engine,
          kind: "regression",
          minimum,
        });
      }
    }
  }
  const sanity = issues.some((issue) => issue.kind !== "regression") ? "failed" : "passed";
  const regression =
    comparisons === 0
      ? "not-evaluated"
      : issues.some((issue) => issue.kind === "regression")
        ? "failed"
        : "passed";
  return {
    issues,
    passed: sanity === "passed" && regression !== "failed",
    regression,
    regressionTolerance: accepted.regressionTolerance,
    sanity,
    sanityTolerance,
  };
}

function acceptedRecord(value: unknown): value is AcceptedResults {
  if (!isRecord(value)) return false;
  const record = value;
  if (
    record["version"] !== 1 ||
    !(record["acceptedAt"] === null || typeof record["acceptedAt"] === "string") ||
    typeof record["regressionTolerance"] !== "number" ||
    !Number.isFinite(record["regressionTolerance"]) ||
    typeof record["datasets"] !== "object" ||
    record["datasets"] === null ||
    Array.isArray(record["datasets"])
  ) {
    return false;
  }
  for (const engines of Object.values(record["datasets"])) {
    if (!isRecord(engines)) return false;
    for (const metrics of Object.values(engines)) {
      if (!isRecord(metrics)) return false;
      const ndcg10 = metrics["ndcg10"];
      if (typeof ndcg10 !== "number" || !Number.isFinite(ndcg10) || ndcg10 < 0 || ndcg10 > 1) {
        return false;
      }
    }
  }
  return true;
}

export async function readAcceptedResults(file: string): Promise<AcceptedResults> {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!acceptedRecord(value)) throw new Error(`Invalid accepted BEIR results file: ${file}`);
  return value;
}

async function installedPackageVersion(
  packageName: string,
  resolveSpecifier = packageName,
): Promise<string> {
  let directory = path.dirname(fileURLToPath(import.meta.resolve(resolveSpecifier)));
  while (true) {
    const manifest = path.join(directory, "package.json");
    try {
      // eslint-disable-next-line no-await-in-loop -- parent manifests are inspected sequentially
      const value: unknown = JSON.parse(await readFile(manifest, "utf8"));
      if (
        isRecord(value) &&
        value["name"] === packageName &&
        typeof value["version"] === "string"
      ) {
        return value["version"];
      }
    } catch (error) {
      if (
        !(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate package manifest for ${packageName}`);
    directory = parent;
  }
}

async function gitMetadata(): Promise<BenchmarkEnvironment["git"]> {
  try {
    const [{ stdout: revision }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"]),
      execFileAsync("git", ["status", "--porcelain"]),
    ]);
    return { dirty: status.trim().length > 0, revision: revision.trim() };
  } catch {
    return { dirty: null, revision: null };
  }
}

export async function collectEnvironment(): Promise<BenchmarkEnvironment> {
  const packageEntries = [
    ["@seekite/build", "@seekite/build"],
    ["@seekite/core", "@seekite/core"],
    ["@seekite/embeddings-ternlight", "@seekite/embeddings-ternlight"],
    ["zbsearch", "zbsearch"],
    ["@zbsearch/stemmers", "@zbsearch/stemmers/english"],
    ["@zbsearch/stopwords", "@zbsearch/stopwords/english"],
    ["@orama/orama", "@orama/orama"],
    ["@orama/stemmers", "@orama/stemmers/english"],
    ["@orama/stopwords", "@orama/stopwords/english"],
    ["minisearch", "minisearch"],
  ] as const;
  const versions = await Promise.all(
    packageEntries.map(
      async ([name, specifier]) => [name, await installedPackageVersion(name, specifier)] as const,
    ),
  );
  const processors = cpus();
  return {
    cpu: { cores: processors.length, model: processors[0]?.model ?? "unknown" },
    git: await gitMetadata(),
    host: hostname(),
    memory: { freeBytesAtStart: freemem(), totalBytes: totalmem() },
    node: process.version,
    packages: Object.fromEntries(versions),
    platform: `${platform()}-${release()}-${process.arch}`,
    v8: process.versions.v8,
  };
}
