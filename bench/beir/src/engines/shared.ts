export function uniqueRankedIds(values: Iterable<string | undefined>, limit: number): string[] {
  const ranked: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    ranked.push(value);
    if (ranked.length >= limit) break;
  }
  return ranked;
}
