import { useEffect, useState } from "react";

interface CorpusManifest {
  path: string;
  chunks: number;
  corpus: string;
  lexical: { dictionary: string; shards: number };
  content: { prefix: string; shards: number };
  vectors?: { file: string };
}

interface SearchManifest {
  version: number;
  corpora: Record<string, CorpusManifest>;
}

interface ArtifactStatsValue {
  chunks: number;
  lexicalBytes: number;
  vectorBytes: number;
  totalBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCorpusManifest(value: unknown): value is CorpusManifest {
  if (!isRecord(value) || !isRecord(value.lexical) || !isRecord(value.content)) return false;
  return (
    typeof value.path === "string" &&
    typeof value.chunks === "number" &&
    typeof value.corpus === "string" &&
    typeof value.lexical.dictionary === "string" &&
    typeof value.lexical.shards === "number" &&
    typeof value.content.prefix === "string" &&
    typeof value.content.shards === "number" &&
    (value.vectors === undefined ||
      (isRecord(value.vectors) && typeof value.vectors.file === "string"))
  );
}

function isSearchManifest(value: unknown): value is SearchManifest {
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    isRecord(value.corpora) &&
    Object.values(value.corpora).every(isCorpusManifest)
  );
}

function parseManifest(serialized: string): SearchManifest {
  const value: unknown = JSON.parse(serialized);
  if (!isSearchManifest(value)) {
    throw new Error("The search manifest does not match the expected format");
  }
  return value;
}

function assetURL(relative: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}search/${relative.replace(/^\/+/, "")}`;
}

async function byteLength(relative: string): Promise<number> {
  const response = await fetch(assetURL(relative));
  if (!response.ok) throw new Error(`Unable to measure ${relative}`);
  return (await response.arrayBuffer()).byteLength;
}

async function measureArtifacts(): Promise<ArtifactStatsValue> {
  const manifestResponse = await fetch(assetURL("manifest.json"));
  if (!manifestResponse.ok) throw new Error("Unable to load the search manifest");
  const manifestBuffer = await manifestResponse.arrayBuffer();
  const manifest = parseManifest(new TextDecoder().decode(manifestBuffer));
  const measured = await Promise.all(
    Object.values(manifest.corpora).map(async (corpus): Promise<ArtifactStatsValue> => {
      const root = corpus.path;
      const [lexicalParts, contentParts, vectorBytes] = await Promise.all([
        Promise.all([
          byteLength(`${root}/${corpus.lexical.dictionary}`),
          ...Array.from({ length: corpus.lexical.shards }, (_, index) =>
            byteLength(`${root}/lexical/postings-${String(index).padStart(3, "0")}.bin`),
          ),
        ]),
        Promise.all([
          byteLength(`${root}/${corpus.corpus}`),
          ...Array.from({ length: corpus.content.shards }, (_, index) =>
            byteLength(`${root}/${corpus.content.prefix}${String(index).padStart(3, "0")}.json`),
          ),
        ]),
        corpus.vectors ? byteLength(`${root}/${corpus.vectors.file}`) : Promise.resolve(0),
      ]);
      const lexicalBytes = lexicalParts.reduce((sum, byteCount) => sum + byteCount, 0);
      const contentBytes = contentParts.reduce((sum, byteCount) => sum + byteCount, 0);
      return {
        chunks: corpus.chunks,
        lexicalBytes,
        vectorBytes,
        totalBytes: lexicalBytes + vectorBytes + contentBytes,
      };
    }),
  );

  return measured.reduce<ArtifactStatsValue>(
    (total, corpus) => ({
      chunks: total.chunks + corpus.chunks,
      lexicalBytes: total.lexicalBytes + corpus.lexicalBytes,
      vectorBytes: total.vectorBytes + corpus.vectorBytes,
      totalBytes: total.totalBytes + corpus.totalBytes,
    }),
    {
      chunks: 0,
      lexicalBytes: 0,
      vectorBytes: 0,
      totalBytes: manifestBuffer.byteLength,
    },
  );
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

export function ArtifactStats() {
  const [stats, setStats] = useState<ArtifactStatsValue>();

  useEffect(() => {
    let active = true;
    const measure = () => {
      void measureArtifacts().then(
        (value) => {
          if (active) setStats(value);
        },
        () => undefined,
      );
    };
    const windowWithIdle = window;
    const identifier = windowWithIdle.requestIdleCallback?.(measure);
    if (identifier === undefined) {
      const timeout = window.setTimeout(measure, 1);
      return () => {
        active = false;
        window.clearTimeout(timeout);
      };
    }
    return () => {
      active = false;
      windowWithIdle.cancelIdleCallback?.(identifier);
    };
  }, []);

  return (
    <dl className="artifact-stats" aria-label="Measured search artifact statistics">
      <div>
        <dt>Docs chunks</dt>
        <dd>{stats?.chunks.toLocaleString() ?? "Measuring…"}</dd>
      </div>
      <div>
        <dt>Lexical index</dt>
        <dd>{stats ? bytes(stats.lexicalBytes) : "Measuring…"}</dd>
      </div>
      <div>
        <dt>Static vectors</dt>
        <dd>{stats ? bytes(stats.vectorBytes) : "Measuring…"}</dd>
      </div>
      <div>
        <dt>Total search data</dt>
        <dd>{stats ? bytes(stats.totalBytes) : "Measured from this build"}</dd>
      </div>
    </dl>
  );
}
