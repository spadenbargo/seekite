import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const apiOrigin = "https://api.svgl.app";
const iconQueries = {
  vite: "Vite",
  astro: "Astro",
  nextjs: "Next.js",
  docusaurus: "Docusaurus",
};
const assetsRoot = path.resolve(import.meta.dirname, "../src/assets");
const destination = path.join(assetsRoot, "brand");

// Brand marks come from the SVGL API; their projects retain all trademark rights.

async function fetchResponse(url, accept) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`Could not fetch ${url}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response;
}

function slugFromRoute(route, title) {
  let routeURL;
  try {
    routeURL = new URL(route);
  } catch (error) {
    throw new Error(`${title} has an invalid icon route`, { cause: error });
  }

  const filename = routeURL.pathname.split("/").at(-1);
  if (!filename?.endsWith(".svg")) {
    throw new Error(`${title} has a non-SVG icon route`);
  }

  const slug = decodeURIComponent(filename.slice(0, -4));
  if (!/^[a-z\d_-]+$/i.test(slug)) {
    throw new Error(`${title} has an unsafe icon slug: ${slug}`);
  }
  return slug;
}

function outputRoutes(name, title, route) {
  if (typeof route === "string") {
    return [{ filename: `${name}.svg`, slug: slugFromRoute(route, title) }];
  }

  if (
    !route ||
    typeof route !== "object" ||
    typeof route.light !== "string" ||
    typeof route.dark !== "string"
  ) {
    throw new Error(`${title} is missing a usable icon route`);
  }

  return [
    { filename: `${name}-light.svg`, slug: slugFromRoute(route.light, `${title} (light)`) },
    { filename: `${name}-dark.svg`, slug: slugFromRoute(route.dark, `${title} (dark)`) },
  ];
}

async function resolveIcon(name, title) {
  const indexURL = new URL(apiOrigin);
  indexURL.searchParams.set("search", title);
  const response = await fetchResponse(indexURL, "application/json");
  const matches = await response.json();
  if (!Array.isArray(matches)) {
    throw new Error(`The icon index returned an invalid response for ${title}`);
  }

  const match = matches.find((candidate) => candidate?.title === title);
  if (!match) {
    throw new Error(`Could not find an exact icon-title match for ${title}`);
  }

  return outputRoutes(name, title, match.route);
}

async function downloadIcon({ filename, slug }) {
  const assetURL = new URL(`/svg/${encodeURIComponent(slug)}.svg`, apiOrigin);
  const response = await fetchResponse(assetURL, "image/svg+xml");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/svg+xml")) {
    throw new Error(`${slug} returned an unexpected content type: ${contentType || "unknown"}`);
  }

  const downloaded = (await response.text()).replaceAll("\r\n", "\n").trimEnd();
  if (!/<svg(?:\s|>)/i.test(downloaded)) {
    throw new Error(`${slug} did not return an SVG document`);
  }
  // Optimized upstream markup may omit the namespace that standalone SVG images
  // need. Keep the vendored file valid when it is loaded through an <img>.
  const source = downloaded.replace(
    /<svg\b(?![^>]*\sxmlns\s*=)/i,
    '<svg xmlns="http://www.w3.org/2000/svg"',
  );
  return { filename, source: `${source}\n` };
}

async function directoryMatches(directory, assets) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  if (
    entries.length !== assets.length ||
    entries.some(
      (entry) => !entry.isFile() || !assets.some(({ filename }) => filename === entry.name),
    )
  ) {
    return false;
  }

  const comparisons = await Promise.all(
    assets.map(async ({ filename, source }) => {
      const existing = await readFile(path.join(directory, filename), "utf8");
      return existing === source;
    }),
  );
  return comparisons.every(Boolean);
}

async function replaceDirectory(stagingDirectory) {
  const backup = path.join(assetsRoot, `.brand-icons-backup-${randomUUID()}`);
  let hasBackup = false;

  try {
    await rename(destination, backup);
    hasBackup = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    await rename(stagingDirectory, destination);
  } catch (error) {
    if (hasBackup) await rename(backup, destination);
    throw error;
  }

  if (hasBackup) await rm(backup, { recursive: true, force: true });
}

const routes = (
  await Promise.all(Object.entries(iconQueries).map(([name, title]) => resolveIcon(name, title)))
).flat();
const assets = (await Promise.all(routes.map(downloadIcon))).toSorted((left, right) =>
  left.filename.localeCompare(right.filename),
);

await mkdir(assetsRoot, { recursive: true });
if (await directoryMatches(destination, assets)) {
  console.log(`Brand icons are already up to date (${assets.length} files).`);
} else {
  const stagingDirectory = await mkdtemp(path.join(assetsRoot, ".brand-icons-"));
  try {
    await Promise.all(
      assets.map(({ filename, source }) =>
        writeFile(path.join(stagingDirectory, filename), source, "utf8"),
      ),
    );
    await replaceDirectory(stagingDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  console.log(`Updated ${assets.length} brand icon files.`);
}
