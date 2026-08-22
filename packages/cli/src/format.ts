export function parseIndexFormat(value: string | number | undefined): 1 | 2 | undefined {
  if (value === undefined) return undefined;
  if (value === "1" || value === 1) return 1;
  if (value === "2" || value === 2) return 2;
  throw new Error(`Invalid index format ${JSON.stringify(value)}; expected 1 or 2`);
}
