import { execFile } from "node:child_process";
import { gzipSync } from "node:zlib";
import { cpus } from "node:os";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { buildSearch, staticVectors, type CorpusConfig, type VectorConfig } from "@seekite/build";
import {
  createSearch,
  type EmbeddingProvider,
  type QueryOptions,
  type SearchMode,
  type SearchResult,
} from "@seekite/core";
import { meanQuality, qualityForQuery } from "./metrics.js";
import { generateSyntheticQueries } from "./synthetic.js";
import type {
  ArtifactMetrics,
  BenchCandidate,
  BenchConfiguration,
  BenchHit,
  BenchOptions,
  BenchRun,
  CandidateRun,
  EmbedMetrics,
  EvalJudgment,
  PerQueryCandidate,
  PerQueryResult,
  QueryMetrics,
  SearchConfigWithBench,
  SyntheticChunk,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface BenchOutcome {
  run: BenchRun;
  file: string;
}

interface InstrumentedProvider {
  provider: EmbeddingProvider;
  embedded: () => number;
  elapsedMs: () => number;
}

interface CandidateArtifacts {
  directory: string;
  chunks: SyntheticChunk[];
}

type QueryResultLike = SearchResult[] | { results: SearchResult[] };

function responseResults(response: QueryResultLike): SearchResult[] {
  return Array.isArray(response) ? response : response.results;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  // eslint-disable-next-line unicorn/no-array-sort -- the package targets Node 20, before toSorted
  const sorted = Array.from(values).sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}

function instrumentProvider(provider: EmbeddingProvider): InstrumentedProvider {
  let count = 0;
  let duration = 0;
  return {
    provider: {
      ...provider,
      async embedDocuments(documents) {
        const started = performance.now();
        try {
          const vectors = await provider.embedDocuments(documents);
          count += documents.length;
          return vectors;
        } finally {
          duration += performance.now() - started;
        }
      },
      embedQuery: (query) => provider.embedQuery(query),
    },
    embedded: () => count,
    elapsedMs: () => duration,
  };
}

function mergeCandidate(base: CorpusConfig, candidate: BenchCandidate): CorpusConfig {
  const { query: _query, ...corpusDelta } = candidate;
  return {
    ...base,
    ...corpusDelta,
    chunk: base.chunk || corpusDelta.chunk ? { ...base.chunk, ...corpusDelta.chunk } : undefined,
  };
}

function vectorsFor(corpus: CorpusConfig): VectorConfig {
  if (corpus.vectors !== undefined) return corpus.vectors;
  if (corpus.embeddings) return staticVectors(corpus.embeddings);
  return false;
}

function embeddingBackend(provider: string | undefined, hint: BenchOptions["backend"]): string {
  if (!provider) return "none";
  return provider.startsWith("seekite:ternlight:") && hint ? hint : provider;
}

function instrumentCorpus(corpus: CorpusConfig): {
  corpus: CorpusConfig;
  instrumentation?: InstrumentedProvider;
} {
  const vectors = vectorsFor(corpus);
  if (!vectors || vectors.mode !== "static") return { corpus };
  const instrumentation = instrumentProvider(vectors.provider);
  return {
    corpus: {
      ...corpus,
      embeddings: undefined,
      vectors: { ...vectors, provider: instrumentation.provider },
    },
    instrumentation,
  };
}

async function readJudgments(root: string, file: string): Promise<EvalJudgment[]> {
  const contents = await readFile(path.resolve(root, file), "utf8");
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const value: unknown = JSON.parse(line);
      if (
        typeof value !== "object" ||
        value === null ||
        !("query" in value) ||
        typeof value.query !== "string" ||
        !("relevant" in value) ||
        !Array.isArray(value.relevant)
      ) {
        throw new Error(`Invalid eval judgment at ${file}:${index + 1}`);
      }
      const relevant = value.relevant.filter(
        (entry: unknown): entry is string => typeof entry === "string",
      );
      if (relevant.length !== value.relevant.length) {
        throw new Error(`Invalid eval judgment at ${file}:${index + 1}`);
      }
      const judgment: EvalJudgment = {
        query: value.query,
        relevant,
      };
      if ("notes" in value && typeof value.notes === "string") judgment.notes = value.notes;
      if ("synthetic" in value && typeof value.synthetic === "boolean") {
        judgment.synthetic = value.synthetic;
      }
      return judgment;
    });
}

async function readJSON<T>(file: string): Promise<T> {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- generated artifacts are validated at their public read boundary
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function loadBuiltChunks(output: string, corpus: string): Promise<SyntheticChunk[]> {
  const manifest = await readJSON<{ corpora: Record<string, Record<string, unknown>> }>(
    path.join(output, "manifest.json"),
  );
  const definition = manifest.corpora[corpus];
  if (!definition) throw new Error(`Bench corpus ${corpus} is missing from the built manifest`);
  const root = path.join(output, typeof definition.path === "string" ? definition.path : corpus);
  if (typeof definition.metadata === "string") {
    const metadata = await readJSON<{ chunks: SyntheticChunk[] }>(
      path.join(root, definition.metadata),
    );
    return metadata.chunks;
  }

  const corpusFile = typeof definition.corpus === "string" ? definition.corpus : "corpus.json";
  const metadata = await readJSON<{
    documents: string[];
    chunks: {
      id: string[];
      document: number[];
      url: string[];
      title: string[];
      heading: string[];
      content: Array<[number, number]>;
    };
  }>(path.join(root, corpusFile));
  const shardCache = new Map<number, Promise<{ chunks: Array<{ content: string }> }>>();
  const contentDefinition = definition.content;
  const prefix =
    typeof contentDefinition === "object" &&
    contentDefinition !== null &&
    "prefix" in contentDefinition &&
    typeof contentDefinition.prefix === "string"
      ? contentDefinition.prefix
      : "content/content-";
  const loadShard = (index: number) => {
    let pending = shardCache.get(index);
    if (!pending) {
      pending = readJSON(path.join(root, `${prefix}${String(index).padStart(3, "0")}.json`));
      shardCache.set(index, pending);
    }
    return pending;
  };
  return Promise.all(
    metadata.chunks.id.map(async (id, index) => {
      const contentLocation = metadata.chunks.content[index] ?? [0, index];
      const shard = await loadShard(contentLocation[0]);
      return {
        id,
        documentId: metadata.documents[metadata.chunks.document[index] ?? 0] ?? id,
        url: metadata.chunks.url[index] ?? "",
        title: metadata.chunks.title[index] ?? "",
        heading: metadata.chunks.heading[index] || undefined,
        content: shard.chunks[contentLocation[1]]?.content ?? "",
      };
    }),
  );
}

function fileFetch(): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    try {
      const file = url.startsWith("file:") ? fileURLToPath(url) : url;
      const data = await readFile(file);
      return new Response(data, {
        headers: {
          "content-type": file.endsWith(".json") ? "application/json" : "application/octet-stream",
        },
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return new Response(null, { status: 404 });
      throw error;
    }
  };
}

function providersFor(corpus: CorpusConfig): EmbeddingProvider[] {
  const vectors = vectorsFor(corpus);
  if (!vectors || !("embedQuery" in vectors.provider)) return [];
  return [vectors.provider];
}

function modesFor(corpus: CorpusConfig): SearchMode[] {
  return vectorsFor(corpus) ? ["lexical", "semantic", "hybrid"] : ["lexical"];
}

function hitFromResult(result: SearchResult): BenchHit {
  return {
    id: result.id,
    documentId: result.document.id,
    title: result.title,
    url: result.url,
    score: result.score,
    lexicalScore: result.lexicalScore,
    semanticScore: result.semanticScore,
  };
}

function rankedRelevanceKeys(hits: BenchHit[], relevant: string[]): string[] {
  const judged = new Set(relevant);
  return hits.map((hit) => (judged.has(hit.id) ? hit.id : hit.documentId));
}

async function queryCandidate(
  artifact: CandidateArtifacts,
  corpusName: string,
  corpus: CorpusConfig,
  candidate: BenchCandidate,
  judgments: EvalJudgment[],
  k: number,
): Promise<{
  quality: CandidateRun["quality"];
  query: QueryMetrics;
  perQuery: Array<Partial<Record<SearchMode, PerQueryCandidate>>>;
}> {
  const client = createSearch({
    url: pathToFileURL(artifact.directory).toString().replace(/\/$/, ""),
    fetch: fileFetch(),
    embeddings: providersFor(corpus),
  });
  await client.load(corpusName);
  const modes = modesFor(corpus);
  const quality: CandidateRun["quality"] = {};
  const perQuery = judgments.map((): Partial<Record<SearchMode, PerQueryCandidate>> => ({}));
  const timings = new Map<SearchMode, number[]>();

  for (const mode of modes) {
    const options: QueryOptions = { ...candidate.query, corpora: [corpusName], mode, limit: k };
    // eslint-disable-next-line no-await-in-loop -- each mode is deliberately warmed before measurement
    await Promise.all(
      judgments.slice(0, 5).map((judgment) => client.query(judgment.query, options)),
    );
    const metrics = [];
    const modeTimings: number[] = [];
    for (let index = 0; index < judgments.length; index += 1) {
      const judgment = judgments[index]!;
      const started = performance.now();
      // eslint-disable-next-line no-await-in-loop -- latency samples must not contend with one another
      const response = (await client.query(judgment.query, options)) as QueryResultLike;
      modeTimings.push(performance.now() - started);
      const hits = responseResults(response).map(hitFromResult);
      const keys = rankedRelevanceKeys(hits, judgment.relevant);
      metrics.push(qualityForQuery(keys, judgment, k));
      const relevant = new Set(judgment.relevant);
      const rankIndex = hits.findIndex(
        (hit) => relevant.has(hit.id) || relevant.has(hit.documentId),
      );
      perQuery[index]![mode] = { rank: rankIndex < 0 ? undefined : rankIndex + 1, hits };
    }
    quality[mode] = meanQuality(metrics);
    timings.set(mode, modeTimings);
  }

  const preferred =
    timings.get(candidate.query?.mode ?? (modes.includes("hybrid") ? "hybrid" : "lexical")) ??
    timings.get("lexical") ??
    [];
  return {
    quality,
    query: { p50ms: percentile(preferred, 0.5), p95ms: percentile(preferred, 0.95) },
    perQuery,
  };
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkFiles(file);
      return Promise.resolve(entry.isFile() ? [file] : []);
    }),
  );
  return nested.flat();
}

async function artifactMetrics(directory: string): Promise<ArtifactMetrics> {
  const files = await walkFiles(directory);
  const raw = { lexicalBytes: 0, vectorsBytes: 0, metadataBytes: 0, totalBytes: 0 };
  const gzip = { lexicalBytes: 0, vectorsBytes: 0, metadataBytes: 0, totalBytes: 0 };
  const measured = await Promise.all(
    files.map(async (file) => {
      const data = await readFile(file);
      const relative = path.relative(directory, file).split(path.sep).join("/");
      const bucket =
        relative.startsWith("lexical/") ||
        relative.includes("/lexical/") ||
        relative.endsWith("lexical.bin")
          ? "lexicalBytes"
          : relative.endsWith("vectors.bin")
            ? "vectorsBytes"
            : "metadataBytes";
      return { bucket, bytes: data.byteLength, gzipBytes: gzipSync(data).byteLength } as const;
    }),
  );
  for (const { bucket, bytes, gzipBytes } of measured) {
    raw[bucket] += bytes;
    gzip[bucket] += gzipBytes;
    raw.totalBytes += bytes;
    gzip.totalBytes += gzipBytes;
  }
  return { ...raw, gzip };
}

async function defaultLabel(): Promise<string> {
  try {
    return (await execFileAsync("git", ["rev-parse", "--short", "HEAD"])).stdout.trim();
  } catch {
    return "local";
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function configuredBench(config: SearchConfigWithBench): BenchConfiguration {
  return config.bench ?? { candidates: { default: {} } };
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

export function formatRun(run: BenchRun): string {
  const rows: string[][] = [];
  for (const [candidate, result] of Object.entries(run.candidates)) {
    for (const mode of ["lexical", "semantic", "hybrid"] as const) {
      const quality = result.quality[mode];
      if (!quality) continue;
      rows.push([
        candidate,
        mode,
        formatNumber(quality.recall),
        formatNumber(quality.mrr),
        formatNumber(quality.ndcg),
        formatNumber(result.query.p50ms),
        `${Math.round(result.artifacts.totalBytes / 1024)} KiB`,
      ]);
    }
  }
  const headers = ["Candidate", "Mode", "Recall", "MRR", "NDCG", "p50 ms", "Artifacts"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const line = (row: string[]) =>
    row
      .map((value, index) => value.padEnd(widths[index]!))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

export async function readRun(file: string): Promise<BenchRun> {
  const run = await readJSON<BenchRun>(file);
  if (run.version !== 1 || !run.candidates || !Array.isArray(run.perQuery)) {
    throw new Error(`Unsupported Seekite bench run at ${file}`);
  }
  return run;
}

export async function bench(
  config: SearchConfigWithBench,
  options: BenchOptions = {},
): Promise<BenchOutcome> {
  const root = path.resolve(options.root ?? process.cwd());
  const benchConfig = configuredBench(config);
  const corpusName = benchConfig.corpus ?? Object.keys(config.corpora)[0];
  if (!corpusName) throw new Error("Cannot benchmark a config with no corpora");
  const baseCorpus = config.corpora[corpusName];
  if (!baseCorpus) throw new Error(`Unknown bench corpus: ${corpusName}`);
  const k = Math.max(1, Math.floor(benchConfig.k ?? 10));
  const candidates =
    Object.keys(benchConfig.candidates).length > 0 ? benchConfig.candidates : { default: {} };
  const tempRoot = await mkdtemp(path.join(tmpdir(), "seekite-bench-"));
  let judgments = benchConfig.queries ? await readJudgments(root, benchConfig.queries) : undefined;
  const candidateRuns: BenchRun["candidates"] = {};
  const perQuery: PerQueryResult[] = [];
  const resolvedConfig: BenchRun["config"]["candidates"] = {};

  try {
    for (const [candidateName, candidate] of Object.entries(candidates)) {
      const merged = mergeCandidate(baseCorpus, candidate);
      const instrumented = instrumentCorpus(merged);
      const output = path.join(tempRoot, safeSegment(candidateName));
      const buildConfig: SearchConfigWithBench = {
        ...config,
        bench: undefined,
        output,
        corpora: { [corpusName]: instrumented.corpus },
      };
      const started = performance.now();
      // eslint-disable-next-line no-await-in-loop -- candidates are isolated to avoid benchmark contention
      const buildResult = await buildSearch(buildConfig, {
        root,
        outputDir: output,
        ...(options.cold ? { cache: false } : {}),
      });
      const buildElapsed = performance.now() - started;
      // eslint-disable-next-line no-await-in-loop -- this candidate's build must finish before it is queried
      const chunks = await loadBuiltChunks(output, corpusName);
      judgments ??= generateSyntheticQueries(chunks, { seed: benchConfig.seed });
      if (judgments.length === 0) throw new Error("The benchmark query set is empty");
      // eslint-disable-next-line no-await-in-loop -- candidates are measured without cross-candidate contention
      const queried = await queryCandidate(
        { directory: output, chunks },
        corpusName,
        instrumented.corpus,
        candidate,
        judgments,
        k,
      );
      const embedded = instrumented.instrumentation?.embedded() ?? 0;
      const embedMs = instrumented.instrumentation?.elapsedMs() ?? buildElapsed;
      const counts = buildResult.corpora[corpusName];
      const chunkCount = counts?.chunks ?? chunks.length;
      const cacheHits =
        counts?.cached === undefined
          ? Math.max(0, chunkCount - embedded) / Math.max(1, chunkCount)
          : counts.cached / Math.max(1, chunkCount);
      const vectorConfig = vectorsFor(instrumented.corpus);
      const provider = vectorConfig ? vectorConfig.provider.id : undefined;
      const embed: EmbedMetrics = {
        seconds: embedMs / 1000,
        textsPerSec: embedded / Math.max(embedMs / 1000, Number.EPSILON),
        backend: embeddingBackend(provider, options.backend),
        cacheHits,
      };
      // eslint-disable-next-line no-await-in-loop -- artifact IO belongs to this isolated candidate sample
      const artifacts = await artifactMetrics(path.join(output, corpusName));
      candidateRuns[candidateName] = {
        quality: queried.quality,
        embed,
        query: queried.query,
        artifacts,
      };
      resolvedConfig[candidateName] = { provider, query: candidate.query };
      judgments.forEach((judgment, index) => {
        const row = (perQuery[index] ??= {
          query: judgment.query,
          relevant: judgment.relevant,
          candidates: {},
        });
        row.candidates[candidateName] = queried.perQuery[index] ?? {};
      });
    }

    const completedJudgments = judgments ?? [];
    const createdAt = new Date().toISOString();
    const label = options.label ?? (await defaultLabel());
    const run: BenchRun = {
      version: 1,
      label,
      synthetic: completedJudgments.every((judgment) => judgment.synthetic === true),
      createdAt,
      config: { corpus: corpusName, k, candidates: resolvedConfig },
      environment: {
        node: process.version,
        cpu: cpus()[0]?.model ?? "unknown",
        platform: `${process.platform}-${process.arch}`,
        backend: [
          ...new Set(Object.values(candidateRuns).map((candidate) => candidate.embed.backend)),
        ].join(","),
        seekite: "0.1.0-alpha.0",
      },
      candidates: candidateRuns,
      perQuery,
    };
    const runDirectory = path.resolve(root, options.outputDir ?? ".seekite/bench");
    await mkdir(runDirectory, { recursive: true });
    const file = path.join(
      runDirectory,
      `${createdAt.replace(/[:.]/g, "-")}-${safeSegment(label)}.json`,
    );
    await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
    if (!options.quiet) console.log(formatRun(run));
    return { run, file };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
