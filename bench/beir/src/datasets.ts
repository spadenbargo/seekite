import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import extract from "extract-zip";
import type { BeirDocument, BeirQuery, DatasetName, LoadedDataset, Qrels } from "./types.js";

const BASE_URL = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets";
const VERIFIED_MARKER = ".seekite-beir-sha256";

export interface DatasetDefinition {
  archiveBytes: number;
  documents: number;
  queries: number;
  referenceNdcg10: number;
  sha256: string;
  url: string;
}

/**
 * SHA-256 values were calculated from the official BEIR-hosted archives on
 * 2026-08-23. A changed upstream archive must be reviewed and deliberately
 * re-pinned; it is never accepted based on a filename alone.
 */
export const DATASETS: Readonly<Record<DatasetName, DatasetDefinition>> = {
  scifact: {
    archiveBytes: 2_816_079,
    documents: 5_183,
    queries: 300,
    referenceNdcg10: 0.665,
    sha256: "536e14446a0ba56ed1398ab1055f39fe852686ecad24a6306c80c490fa8e0165",
    url: `${BASE_URL}/scifact.zip`,
  },
  nfcorpus: {
    archiveBytes: 2_448_432,
    documents: 3_633,
    queries: 323,
    referenceNdcg10: 0.325,
    sha256: "efe5be03f8c5b86a5870102d0599d227c8c6e2484328e68c6522560385671b0b",
    url: `${BASE_URL}/nfcorpus.zip`,
  },
  arguana: {
    archiveBytes: 3_773_617,
    documents: 8_674,
    queries: 1_406,
    referenceNdcg10: 0.414,
    sha256: "cfdf79adce27a401b3cd3ea267903134dbfab2c6afeb95d7fe5724a00bf7557b",
    url: `${BASE_URL}/arguana.zip`,
  },
};

function repositoryRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

export function defaultBeirCacheDirectory(): string {
  const configured = process.env["BEIR_CACHE_DIR"];
  return configured ? path.resolve(configured) : path.join(repositoryRoot(), ".cache", "beir");
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function moveAside(file: string): Promise<void> {
  if (!(await exists(file))) return;
  await rename(file, `${file}.invalid-${Date.now()}-${randomUUID().slice(0, 8)}`);
}

async function downloadArchive(
  definition: DatasetDefinition,
  destination: string,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await fetcher(definition.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Unable to download ${definition.url}: HTTP ${response.status}`);
  }
  if (!response.body) throw new Error(`Unable to download ${definition.url}: empty response body`);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    // eslint-disable-next-line no-await-in-loop -- a response body is inherently sequential
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > definition.archiveBytes) {
      // eslint-disable-next-line no-await-in-loop -- cancellation belongs to this sequential stream
      await reader.cancel();
      throw new Error(
        `Archive from ${definition.url} exceeded its pinned size (${definition.archiveBytes} bytes)`,
      );
    }
    chunks.push(item.value);
  }
  if (bytes !== definition.archiveBytes) {
    throw new Error(
      `Archive from ${definition.url} has ${bytes} bytes; expected ${definition.archiveBytes}`,
    );
  }

  const data = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const digest = createHash("sha256").update(data).digest("hex");
  if (digest !== definition.sha256) {
    throw new Error(
      `Archive checksum mismatch for ${definition.url}: received ${digest}, expected ${definition.sha256}`,
    );
  }
  await writeFile(destination, data, { flag: "wx" });
}

async function ensureArchive(
  name: DatasetName,
  cacheDirectory: string,
  fetcher: typeof fetch,
): Promise<string> {
  const definition = DATASETS[name];
  const archive = path.join(cacheDirectory, `${name}.zip`);
  if (await exists(archive)) {
    const [digest, archiveStat] = await Promise.all([sha256File(archive), stat(archive)]);
    if (digest === definition.sha256 && archiveStat.size === definition.archiveBytes)
      return archive;
    await moveAside(archive);
  }

  const temporary = path.join(cacheDirectory, `.${name}-${randomUUID()}.download`);
  try {
    console.log(`Downloading pinned BEIR dataset ${definition.url}`);
    await downloadArchive(definition, temporary, fetcher);
    await rename(temporary, archive);
    return archive;
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (
        !(
          typeof cleanupError === "object" &&
          cleanupError !== null &&
          "code" in cleanupError &&
          cleanupError.code === "ENOENT"
        )
      ) {
        console.warn(`Unable to clean incomplete download ${temporary}`, cleanupError);
      }
    }
    throw error;
  }
}

async function datasetReady(name: DatasetName, directory: string): Promise<boolean> {
  const required = [
    path.join(directory, "corpus.jsonl"),
    path.join(directory, "queries.jsonl"),
    path.join(directory, "qrels", "test.tsv"),
  ];
  if (!(await Promise.all(required.map(exists))).every(Boolean)) return false;
  try {
    return (
      (await readFile(path.join(directory, VERIFIED_MARKER), "utf8")).trim() ===
      DATASETS[name].sha256
    );
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function ensureDataset(
  name: DatasetName,
  options: { cacheDirectory?: string; fetch?: typeof fetch } = {},
): Promise<string> {
  const cacheDirectory = path.resolve(options.cacheDirectory ?? defaultBeirCacheDirectory());
  const directory = path.join(cacheDirectory, name);
  if (await datasetReady(name, directory)) return directory;

  await mkdir(cacheDirectory, { recursive: true });
  const archive = await ensureArchive(name, cacheDirectory, options.fetch ?? globalThis.fetch);
  const extractionRoot = path.join(cacheDirectory, `.${name}-${randomUUID()}.extract`);
  try {
    await mkdir(extractionRoot, { recursive: false });
    await extract(archive, { dir: extractionRoot });
    const extracted = path.join(extractionRoot, name);
    const required = [
      path.join(extracted, "corpus.jsonl"),
      path.join(extracted, "queries.jsonl"),
      path.join(extracted, "qrels", "test.tsv"),
    ];
    if (!(await Promise.all(required.map(exists))).every(Boolean)) {
      throw new Error(`Pinned ${name}.zip does not contain the expected BEIR dataset layout`);
    }
    await writeFile(path.join(extracted, VERIFIED_MARKER), `${DATASETS[name].sha256}\n`, {
      flag: "wx",
    });
    await moveAside(directory);
    await rename(extracted, directory);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
  return directory;
}

async function* lines(file: string): AsyncGenerator<{ line: string; number: number }> {
  const input = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  let number = 0;
  for await (const line of input) {
    number += 1;
    if (line.trim()) yield { line, number };
  }
}

function jsonRecord(file: string, number: number, line: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON at ${file}:${number}`, { cause: error });
  }
  if (!isRecord(value)) {
    throw new Error(`Expected an object at ${file}:${number}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordId(value: Record<string, unknown>): string {
  const id = value["_id"];
  if (typeof id === "string") return id;
  return typeof id === "number" && Number.isFinite(id) ? String(id) : "";
}

async function loadQrels(file: string): Promise<Qrels> {
  const qrels: Qrels = new Map();
  let headerSeen = false;
  for await (const entry of lines(file)) {
    const columns = entry.line.split("\t");
    if (!headerSeen) {
      headerSeen = true;
      if (columns[0] === "query-id" && columns[1] === "corpus-id") continue;
    }
    const [queryId, documentId, rawScore] = columns;
    const score = Number(rawScore);
    if (!queryId || !documentId || columns.length !== 3 || !Number.isFinite(score)) {
      throw new Error(`Invalid qrel at ${file}:${entry.number}`);
    }
    const documents = qrels.get(queryId) ?? new Map<string, number>();
    if (documents.has(documentId)) {
      throw new Error(`Duplicate qrel for query ${queryId} and document ${documentId}`);
    }
    documents.set(documentId, score);
    qrels.set(queryId, documents);
  }
  return qrels;
}

async function loadDocuments(file: string): Promise<BeirDocument[]> {
  const documents: BeirDocument[] = [];
  const ids = new Set<string>();
  for await (const entry of lines(file)) {
    const value = jsonRecord(file, entry.number, entry.line);
    const id = recordId(value);
    const title = value["title"];
    const text = value["text"];
    if (!id || (title !== undefined && typeof title !== "string") || typeof text !== "string") {
      throw new Error(`Invalid BEIR corpus record at ${file}:${entry.number}`);
    }
    if (ids.has(id)) throw new Error(`Duplicate BEIR corpus id ${id} at ${file}:${entry.number}`);
    ids.add(id);
    documents.push({ id, title: title ?? "", text });
  }
  return documents;
}

async function loadQueries(file: string, qrels: Qrels): Promise<BeirQuery[]> {
  const queries: BeirQuery[] = [];
  const ids = new Set<string>();
  for await (const entry of lines(file)) {
    const value = jsonRecord(file, entry.number, entry.line);
    const id = recordId(value);
    const text = value["text"];
    if (!id || typeof text !== "string") {
      throw new Error(`Invalid BEIR query record at ${file}:${entry.number}`);
    }
    if (ids.has(id)) throw new Error(`Duplicate BEIR query id ${id} at ${file}:${entry.number}`);
    ids.add(id);
    if (qrels.has(id)) queries.push({ id, text });
  }
  const missing = [...qrels.keys()].filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw new Error(`Qrels reference ${missing.length} missing queries (first: ${missing[0]})`);
  }
  return queries;
}

export async function loadDatasetDirectory(
  name: DatasetName,
  directory: string,
  options: { validateExpectedCounts?: boolean } = {},
): Promise<LoadedDataset> {
  const qrels = await loadQrels(path.join(directory, "qrels", "test.tsv"));
  const [documents, queries] = await Promise.all([
    loadDocuments(path.join(directory, "corpus.jsonl")),
    loadQueries(path.join(directory, "queries.jsonl"), qrels),
  ]);

  if (options.validateExpectedCounts !== false) {
    const expected = DATASETS[name];
    if (documents.length !== expected.documents || queries.length !== expected.queries) {
      throw new Error(
        `${name} count mismatch: loaded ${documents.length} documents/${queries.length} judged queries; expected ${expected.documents}/${expected.queries}`,
      );
    }
  }
  return { name, documents, queries, qrels };
}

export async function loadDataset(
  name: DatasetName,
  options: { cacheDirectory?: string; fetch?: typeof fetch } = {},
): Promise<LoadedDataset> {
  const directory = await ensureDataset(name, options);
  return loadDatasetDirectory(name, directory);
}
