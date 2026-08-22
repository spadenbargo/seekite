import { analyze, type AnalyzerOptions, type ExpandedTerm } from "./analyzer.js";
import type {
  LexicalDictionaryV2,
  LexicalField,
  LexicalIndex,
  LexicalIndexV2,
  LexicalPostingV2,
  MatchedTerm,
  SearchChunk,
} from "./types.js";

const WORDS = /[\p{L}\p{N}]+/gu;

export const DEFAULT_FIELD_WEIGHTS: Record<LexicalField, number> = {
  title: 2,
  heading: 1.5,
  body: 1,
};

export function tokenize(value: string): string[] {
  return (value.toLocaleLowerCase().match(WORDS) ?? []).filter((term) => term.length > 1);
}

/** Create the legacy JSON-friendly format-v1 lexical index. */
export function createLexicalIndex(contents: string[]): LexicalIndex {
  const postings: LexicalIndex["postings"] = Object.create(null) as LexicalIndex["postings"];
  const lengths = contents.map((content, documentIndex) => {
    const terms = tokenize(content);
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    for (const [term, frequency] of frequencies) {
      (postings[term] ??= []).push([documentIndex, frequency]);
    }
    return terms.length;
  });

  return {
    version: 1,
    documentCount: contents.length,
    averageLength: lengths.reduce((sum, length) => sum + length, 0) / Math.max(lengths.length, 1),
    lengths,
    postings,
  };
}

export function searchLexical(index: LexicalIndex, query: string): Map<number, number> {
  const scores = new Map<number, number>();
  const k1 = 1.2;
  const b = 0.75;

  for (const term of new Set(tokenize(query))) {
    const postings = index.postings[term];
    if (!postings) continue;
    const inverseDocumentFrequency = Math.log(
      1 + (index.documentCount - postings.length + 0.5) / (postings.length + 0.5),
    );
    for (const [documentIndex, frequency] of postings) {
      const length = index.lengths[documentIndex] ?? index.averageLength;
      const denominator =
        frequency + k1 * (1 - b + b * (length / Math.max(index.averageLength, 1)));
      const score = inverseDocumentFrequency * ((frequency * (k1 + 1)) / denominator);
      scores.set(documentIndex, (scores.get(documentIndex) ?? 0) + score);
    }
  }

  return scores;
}

function frequencies(terms: string[]): Map<string, number> {
  const output = new Map<string, number>();
  for (const term of terms) output.set(term, (output.get(term) ?? 0) + 1);
  return output;
}

export function createLexicalIndexV2(
  chunks: Array<Pick<SearchChunk, "title" | "heading" | "content">>,
  analyzer: AnalyzerOptions,
): LexicalIndexV2 {
  const fieldLengths: LexicalIndexV2["fieldLengths"] = [[], [], []];
  const byTerm = new Map<string, LexicalPostingV2[]>();

  chunks.forEach((chunk, chunkIndex) => {
    const fields = [
      analyze(chunk.title, analyzer),
      analyze(chunk.heading ?? "", analyzer),
      analyze(chunk.content, analyzer),
    ] as const;
    fields.forEach((terms, field) => fieldLengths[field]!.push(terms.length));
    const termFields = fields.map(frequencies);
    const terms = new Set(termFields.flatMap((field) => [...field.keys()]));
    for (const term of terms) {
      const posting: LexicalPostingV2 = {
        chunk: chunkIndex,
        frequencies: [
          termFields[0]!.get(term) ?? 0,
          termFields[1]!.get(term) ?? 0,
          termFields[2]!.get(term) ?? 0,
        ],
      };
      const postings = byTerm.get(term);
      if (postings) postings.push(posting);
      else byTerm.set(term, [posting]);
    }
  });

  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return {
    version: 2,
    documentCount: chunks.length,
    averageFieldLengths: [
      average(fieldLengths[0]),
      average(fieldLengths[1]),
      average(fieldLengths[2]),
    ],
    fieldLengths,
    terms: [...byTerm]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([term, postings]) => ({ term, postings })),
  };
}

export interface LexicalScoresV2 {
  scores: Map<number, number>;
  terms: Map<number, MatchedTerm[]>;
}

export function scoreLexicalV2(
  dictionary: LexicalDictionaryV2,
  expansions: ExpandedTerm[],
  postings: ReadonlyMap<number, LexicalPostingV2[]>,
  overrides: Partial<Record<LexicalField, number>> = {},
): LexicalScoresV2 {
  const weights = {
    title: overrides.title ?? DEFAULT_FIELD_WEIGHTS.title,
    heading: overrides.heading ?? DEFAULT_FIELD_WEIGHTS.heading,
    body: overrides.body ?? DEFAULT_FIELD_WEIGHTS.body,
  };
  const averageLength =
    weights.title * dictionary.averageFieldLengths[0] +
    weights.heading * dictionary.averageFieldLengths[1] +
    weights.body * dictionary.averageFieldLengths[2];
  const perSource = new Map<number, Map<number, { score: number; term: MatchedTerm }>>();
  const k1 = 1.2;
  const b = 0.75;

  for (const expansion of expansions) {
    const definition = dictionary.terms[expansion.dictionaryIndex];
    if (!definition) continue;
    const inverseDocumentFrequency = Math.log(
      1 +
        (dictionary.documentCount - definition.documentFrequency + 0.5) /
          (definition.documentFrequency + 0.5),
    );
    let sourceScores = perSource.get(expansion.sourceIndex);
    if (!sourceScores) {
      sourceScores = new Map();
      perSource.set(expansion.sourceIndex, sourceScores);
    }
    for (const posting of postings.get(expansion.dictionaryIndex) ?? []) {
      const weightedFrequency =
        weights.title * posting.frequencies[0] +
        weights.heading * posting.frequencies[1] +
        weights.body * posting.frequencies[2];
      const weightedLength =
        weights.title * (dictionary.fieldLengths[0][posting.chunk] ?? 0) +
        weights.heading * (dictionary.fieldLengths[1][posting.chunk] ?? 0) +
        weights.body * (dictionary.fieldLengths[2][posting.chunk] ?? 0);
      const denominator =
        weightedFrequency + k1 * (1 - b + (b * weightedLength) / Math.max(averageLength, 1));
      const score =
        inverseDocumentFrequency *
        ((weightedFrequency * (k1 + 1)) / denominator) *
        expansion.weight;
      const previous = sourceScores.get(posting.chunk);
      if (!previous || score > previous.score) {
        sourceScores.set(posting.chunk, {
          score,
          term: {
            term: expansion.term,
            source: expansion.source,
            kind: expansion.kind,
            distance: expansion.distance,
          },
        });
      }
    }
  }

  const scores = new Map<number, number>();
  const matchedTerms = new Map<number, MatchedTerm[]>();
  for (const sourceScores of perSource.values()) {
    for (const [chunk, match] of sourceScores) {
      scores.set(chunk, (scores.get(chunk) ?? 0) + match.score);
      const terms = matchedTerms.get(chunk);
      if (terms) terms.push(match.term);
      else matchedTerms.set(chunk, [match.term]);
    }
  }
  return { scores, terms: matchedTerms };
}
