import type { AnalyzerManifest, CustomAnalyzer, DictionaryTermV2, MatchedTerm } from "./types.js";

const WORDS = /[\p{L}\p{N}]+/gu;
const MARKS = /\p{M}+/gu;
const VOWEL = /[aeiouy]/;

export interface AnalyzedToken {
  raw: string;
  term: string;
  start: number;
  end: number;
}

export interface AnalyzerOptions extends AnalyzerManifest {
  custom?: CustomAnalyzer;
}

export interface QueryToken {
  term: string;
  prefix: boolean;
  index: number;
}

export interface ExpandedTerm extends MatchedTerm {
  sourceIndex: number;
  weight: number;
  dictionaryIndex: number;
}

export const EXPANSION_WEIGHTS = {
  exact: 1,
  prefix: 0.85,
  fuzzy1: 0.7,
  fuzzy2: 0.5,
} as const;

export function fold(value: string): string {
  return value.normalize("NFKD").replace(MARKS, "").toLocaleLowerCase();
}

function containsVowel(value: string): boolean {
  return VOWEL.test(value);
}

/** A deliberately small Porter2-family stemmer for the English opt-in path. */
export function stemEnglish(input: string): string {
  let word = input;
  if (word.length <= 3) return word;

  if (word.endsWith("sses")) word = word.slice(0, -2);
  else if (word.endsWith("ies")) word = `${word.slice(0, -3)}i`;
  else if (!word.endsWith("ss") && word.endsWith("s") && containsVowel(word.slice(0, -2)))
    word = word.slice(0, -1);

  if (word.endsWith("eedly") && word.length > 6) word = `${word.slice(0, -5)}ee`;
  else if (word.endsWith("eed") && word.length > 4) word = `${word.slice(0, -3)}ee`;
  else {
    const suffix = ["ingly", "edly", "ing", "ed"].find(
      (candidate) => word.endsWith(candidate) && containsVowel(word.slice(0, -candidate.length)),
    );
    if (suffix) {
      word = word.slice(0, -suffix.length);
      if (/(at|bl|iz)$/.test(word)) word += "e";
      else if (/([^aeiou])\1$/.test(word) && !/(ll|ss|zz)$/.test(word)) word = word.slice(0, -1);
    }
  }

  if (word.endsWith("y") && word.length > 2 && !VOWEL.test(word.at(-2) ?? ""))
    word = `${word.slice(0, -1)}i`;
  const replacements: Array<[RegExp, string]> = [
    [/ational$/, "ate"],
    [/tional$/, "tion"],
    [/enci$/, "ence"],
    [/anci$/, "ance"],
    [/abli$/, "able"],
    [/entli$/, "ent"],
    [/izer$/, "ize"],
    [/ization$/, "ize"],
    [/ation$/, "ate"],
    [/ator$/, "ate"],
    [/alism$/, "al"],
    [/fulness$/, "ful"],
    [/ousness$/, "ous"],
    [/iveness$/, "ive"],
    [/biliti$/, "ble"],
    [/icate$/, "ic"],
    [/iciti$/, "ic"],
    [/ical$/, "ic"],
    [/ness$/, ""],
    [/ful$/, ""],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(word) && word.length - (pattern.source.length - 2) >= 3) {
      word = word.replace(pattern, replacement);
      break;
    }
  }
  if (
    word.length > 4 &&
    /(ement|ment|able|ible|ance|ence|ate|iti|ion|al|er|ic|ous|ive|ize)$/.test(word)
  ) {
    const reduced = word.replace(
      /(ement|ment|able|ible|ance|ence|ate|iti|ion|al|er|ic|ous|ive|ize)$/,
      "",
    );
    if (reduced.length >= 3) word = reduced;
  }
  if (word.length > 4 && word.endsWith("e")) word = word.slice(0, -1);
  return word;
}

export function analyzeToken(value: string, options: AnalyzerOptions): string {
  const normalized = options.folding ? fold(value) : value.toLocaleLowerCase();
  if (options.stemmer === "en") return stemEnglish(normalized);
  if (options.stemmer?.startsWith("custom:")) {
    if (!options.custom) throw new Error(`Missing analyzer for ${options.stemmer}`);
    return options.custom(normalized);
  }
  return normalized;
}

export function tokenizeWithOffsets(value: string, options: AnalyzerOptions): AnalyzedToken[] {
  return [...value.matchAll(WORDS)]
    .map((match) => ({
      raw: match[0],
      term: analyzeToken(match[0], options),
      start: match.index,
      end: match.index + match[0].length,
    }))
    .filter((token) => token.term.length > 1);
}

export function analyze(value: string, options: AnalyzerOptions): string[] {
  return tokenizeWithOffsets(value, options).map((token) => token.term);
}

export function analyzeQuery(value: string, options: AnalyzerOptions): QueryToken[] {
  const terms = analyze(value, options);
  const unfinished = /[\p{L}\p{N}]$/u.test(value);
  return terms.map((term, index) => ({
    term,
    index,
    prefix: unfinished && index === terms.length - 1,
  }));
}

function lowerBound(terms: readonly string[], target: string): number {
  let low = 0;
  let high = terms.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((terms[middle] ?? "") < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function dictionaryPrefixRange(
  terms: readonly string[],
  prefix: string,
): [start: number, end: number] {
  return [lowerBound(terms, prefix), lowerBound(terms, `${prefix}\u{10ffff}`)];
}

export function boundedLevenshtein(
  left: string,
  right: string,
  maximum: number,
): number | undefined {
  if (Math.abs(left.length - right.length) > maximum) return undefined;
  if (left === right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = Array.from<number>({ length: right.length + 1 }).fill(maximum + 1);
    current[0] = leftIndex;
    const start = Math.max(1, leftIndex - maximum);
    const end = Math.min(right.length, leftIndex + maximum);
    let rowMinimum = maximum + 1;
    for (let rightIndex = start; rightIndex <= end; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]!);
    }
    if (rowMinimum > maximum) return undefined;
    previous = current;
  }
  const distance = previous[right.length]!;
  return distance <= maximum ? distance : undefined;
}

export function expandQueryTerms(
  dictionary: readonly DictionaryTermV2[],
  query: string,
  analyzer: AnalyzerOptions,
  maxExpansions = 16,
): ExpandedTerm[] {
  const terms = dictionary.map((entry) => entry.term);
  const expanded: ExpandedTerm[] = [];
  const add = (
    source: QueryToken,
    dictionaryIndex: number,
    kind: "exact" | "prefix" | "fuzzy",
    distance?: number,
  ) => {
    const term = terms[dictionaryIndex];
    if (
      !term ||
      expanded.some(
        (entry) => entry.sourceIndex === source.index && entry.dictionaryIndex === dictionaryIndex,
      )
    )
      return;
    expanded.push({
      term,
      source: source.term,
      kind,
      distance,
      sourceIndex: source.index,
      dictionaryIndex,
      weight:
        kind === "exact"
          ? EXPANSION_WEIGHTS.exact
          : kind === "prefix"
            ? EXPANSION_WEIGHTS.prefix
            : distance === 1
              ? EXPANSION_WEIGHTS.fuzzy1
              : EXPANSION_WEIGHTS.fuzzy2,
    });
  };

  for (const source of analyzeQuery(query, analyzer)) {
    const exact = lowerBound(terms, source.term);
    const hasExact = terms[exact] === source.term;
    if (hasExact) add(source, exact, "exact");

    let hasPrefix = false;
    if (source.prefix) {
      const [start, end] = dictionaryPrefixRange(terms, source.term);
      const candidates = Array.from({ length: end - start }, (_, index) => start + index)
        .filter((index) => !hasExact || index !== exact)
        .sort(
          (left, right) =>
            dictionary[right]!.documentFrequency - dictionary[left]!.documentFrequency ||
            left - right,
        )
        .slice(0, Math.max(0, maxExpansions - (hasExact ? 1 : 0)));
      hasPrefix = hasExact || candidates.length > 0;
      for (const dictionaryIndex of candidates) add(source, dictionaryIndex, "prefix");
    }

    if (!hasExact && (!source.prefix || !hasPrefix)) {
      const maximum = source.term.length >= 8 ? 2 : source.term.length >= 4 ? 1 : 0;
      if (maximum === 0) continue;
      const candidates: Array<{ index: number; distance: number }> = [];
      for (let index = 0; index < terms.length; index += 1) {
        const candidate = terms[index]!;
        if (
          candidate[0] !== source.term[0] ||
          Math.abs(candidate.length - source.term.length) > maximum
        )
          continue;
        const distance = boundedLevenshtein(source.term, candidate, maximum);
        if (distance && distance <= maximum) candidates.push({ index, distance });
      }
      candidates.sort(
        (left, right) =>
          left.distance - right.distance ||
          dictionary[right.index]!.documentFrequency - dictionary[left.index]!.documentFrequency ||
          left.index - right.index,
      );
      for (const candidate of candidates.slice(0, maxExpansions))
        add(source, candidate.index, "fuzzy", candidate.distance);
    }
  }
  return expanded;
}
