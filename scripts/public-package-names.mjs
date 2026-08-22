import { readdir, readFile } from "node:fs/promises";

const packageRoots = [
  new URL("../packages/", import.meta.url),
  new URL("../packages/engine-native/npm/", import.meta.url),
];

const manifestPaths = (
  await Promise.all(
    packageRoots.map(async (packageRoot) =>
      (await readdir(packageRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => new URL(`./${entry.name}/package.json`, packageRoot)),
    ),
  )
).flat();

const names = (
  await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        return !manifest.private && typeof manifest.name === "string" ? manifest.name : undefined;
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
    }),
  )
).filter((name) => name !== undefined);

process.stdout.write(`${names.toSorted((left, right) => left.localeCompare(right)).join("\n")}\n`);
