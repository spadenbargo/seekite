const UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
};

export function parseByteSize(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?i?b)?\s*$/i.exec(value);
  const amount = match?.[1];
  const unit = match?.[2]?.toLowerCase() ?? "b";
  const multiplier = UNITS[unit];
  if (!amount || multiplier === undefined)
    throw new Error(`Invalid byte size ${JSON.stringify(value)} (try 500MB or 2GiB)`);
  const bytes = Number(amount) * multiplier;
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error(`Byte size ${JSON.stringify(value)} is outside the supported range`);
  return bytes;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
