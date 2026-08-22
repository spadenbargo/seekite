import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BenchRun } from "./types.js";

const BASELINE_CREATED_AT = "1970-01-01T00:00:00.000Z";

/**
 * Strip machine- and clock-dependent measurements while retaining every
 * quality and artifact-size gate used by run comparison.
 */
export function createDeterministicBaseline(run: BenchRun, label = "baseline"): BenchRun {
  const baseline = structuredClone(run);
  baseline.label = label;
  baseline.createdAt = BASELINE_CREATED_AT;
  baseline.environment = {
    node: "reference",
    cpu: "reference",
    platform: "reference",
    backend: "reference",
    seekite: run.environment.seekite,
  };
  baseline.perQuery = [];
  for (const [name, candidate] of Object.entries(baseline.candidates)) {
    candidate.embed = {
      seconds: 0,
      textsPerSec: 0,
      backend: baseline.config.candidates[name]?.provider ? "reference" : "none",
      cacheHits: 0,
    };
    candidate.query = { p50ms: 0, p95ms: 0 };
  }
  return baseline;
}

export async function writeBaseline(
  run: BenchRun,
  file: string,
  label = "baseline",
): Promise<string> {
  const output = path.resolve(file);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(createDeterministicBaseline(run, label), null, 2)}\n`);
  return output;
}
