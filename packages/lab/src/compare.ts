import type { BenchComparison, BenchRun, ComparisonDelta } from "./types.js";

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

export function compareRuns(before: BenchRun, after: BenchRun, tolerance = 0.01): BenchComparison {
  const deltas: ComparisonDelta[] = [];
  for (const [candidate, previous] of Object.entries(before.candidates)) {
    const current = after.candidates[candidate];
    for (const mode of ["lexical", "semantic", "hybrid"] as const) {
      const left = previous.quality[mode];
      if (!left) continue;
      const right = current?.quality[mode];
      deltas.push({
        candidate,
        mode,
        recall: (right?.recall ?? 0) - left.recall,
        mrr: (right?.mrr ?? 0) - left.mrr,
        ndcg: (right?.ndcg ?? 0) - left.ndcg,
      });
    }
  }
  const regressions = deltas.filter((delta) => delta.ndcg < -Math.abs(tolerance));
  return { deltas, tolerance: Math.abs(tolerance), regressions, passed: regressions.length === 0 };
}

export function formatComparison(comparison: BenchComparison): string {
  const rows = comparison.deltas.map((delta) => [
    delta.candidate,
    delta.mode,
    signed(delta.recall),
    signed(delta.mrr),
    signed(delta.ndcg),
    delta.ndcg < -comparison.tolerance ? "regression" : "ok",
  ]);
  const widths = [
    "Candidate".length,
    "Mode".length,
    "Recall".length,
    "MRR".length,
    "NDCG".length,
    "Status".length,
  ];
  for (const row of rows)
    row.forEach((value, index) => (widths[index] = Math.max(widths[index]!, value.length)));
  const line = (values: string[]) =>
    values
      .map((value, index) => value.padEnd(widths[index]!))
      .join("  ")
      .trimEnd();
  return [line(["Candidate", "Mode", "Recall", "MRR", "NDCG", "Status"]), ...rows.map(line)].join(
    "\n",
  );
}
