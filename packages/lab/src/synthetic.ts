import { tokenize } from "@seekite/core";
import type { EvalJudgment, SyntheticChunk } from "./types.js";

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function transpose(value: string, random: () => number): string | undefined {
  const points = Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
  const candidates: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    if (points[index] !== points[index + 1]) candidates.push(index);
  }
  if (candidates.length === 0) return undefined;
  const index = candidates[Math.floor(random() * candidates.length)]!;
  const first = points[index]!;
  points[index] = points[index + 1]!;
  points[index + 1] = first;
  return points.join("");
}

function salientTerms(chunks: SyntheticChunk[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const chunk of chunks) {
    const terms = new Set(tokenize(`${chunk.title} ${chunk.heading ?? ""} ${chunk.content}`));
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  return frequencies;
}

function salientTerm(
  chunk: SyntheticChunk,
  documentFrequencies: Map<string, number>,
  total: number,
): string | undefined {
  const titleTerms = new Set(tokenize(`${chunk.title} ${chunk.heading ?? ""}`));
  return [...new Set(tokenize(chunk.content))]
    .filter((term) => term.length >= 4 && !titleTerms.has(term))
    .sort((left, right) => {
      const leftScore = Math.log(1 + total / (documentFrequencies.get(left) ?? 1));
      const rightScore = Math.log(1 + total / (documentFrequencies.get(right) ?? 1));
      return rightScore - leftScore || left.localeCompare(right);
    })[0];
}

/** Generate a stable retrievability set. It is a regression aid, not human relevance judgment. */
export function generateSyntheticQueries(
  chunks: SyntheticChunk[],
  options: { seed?: number; sampleSize?: number } = {},
): EvalJudgment[] {
  const random = seededRandom(options.seed ?? 0x5ee117);
  const shuffled = [...chunks].sort((left, right) => left.id.localeCompare(right.id));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  const sampled = shuffled.slice(0, Math.min(options.sampleSize ?? 100, shuffled.length));
  const frequencies = salientTerms(chunks);
  const judgments: EvalJudgment[] = [];
  const seen = new Set<string>();

  const add = (query: string | undefined, chunk: SyntheticChunk) => {
    const cleaned = query?.replace(/\s+/g, " ").trim();
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    judgments.push({ query: cleaned, relevant: [chunk.documentId], synthetic: true });
  };

  for (const chunk of sampled) {
    add(chunk.heading || chunk.title, chunk);
    const salient = salientTerm(chunk, frequencies, chunks.length);
    add(salient ? `${chunk.title} ${salient}` : chunk.title, chunk);
    const probe =
      salient ?? tokenize(chunk.heading || chunk.title).find((term) => term.length >= 4);
    add(probe ? transpose(probe, random) : undefined, chunk);
  }
  return judgments;
}
