import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const appRoot = path.resolve(import.meta.dirname, "..");
const candidates = [
  path.join(appRoot, "dist/client"),
  path.join(appRoot, ".output/public"),
  path.join(appRoot, "dist"),
];
const output = candidates.find((directory) => existsSync(path.join(directory, "index.html")));
if (!output) throw new Error("TanStack Start did not emit a static index.html");

// Fumadocs' responsive docs layout, navigation and TOC replace the previous
// hand-rolled shell. Keep a measured compressed ceiling with modest headroom.
const maximumInitialJavaScriptKib = 210;

function files(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(absolute, extension)
      : entry.name.endsWith(extension)
        ? [absolute]
        : [];
  });
}

function required(relative) {
  const absolute = path.join(output, relative);
  if (!existsSync(absolute)) throw new Error(`Missing prerendered output: ${relative}`);
  return absolute;
}

required("playground/index.html");
required("docs/search-quality/index.html");
required("docs/integrations/vite/index.html");
required("_headers");
required("search/manifest.json");

const htmlFiles = files(output, ".html");
const htmlCache = new Map(htmlFiles.map((htmlFile) => [htmlFile, readFileSync(htmlFile, "utf8")]));
let maximumInitialGzipBytes = 0;
let maximumInitialGzipPage = "index.html";
let checkedLinks = 0;

function outputForPath(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "");
  const outputCandidates = relative
    ? [path.join(output, relative, "index.html"), path.join(output, `${relative}.html`)]
    : [path.join(output, "index.html")];
  return outputCandidates.find(existsSync);
}

function pageURL(htmlFile) {
  const relative = path.relative(output, htmlFile).split(path.sep).join("/");
  if (relative === "index.html") return "https://seekite.invalid/";
  if (relative.endsWith("/index.html")) {
    return `https://seekite.invalid/${relative.slice(0, -"index.html".length)}`;
  }
  return `https://seekite.invalid/${relative}`;
}

for (const htmlFile of htmlFiles) {
  const html = htmlCache.get(htmlFile);
  const JavaScriptURLs = [
    ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*>/g),
    ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+\.js)"[^>]*>/g),
  ].map((match) => match[1]);
  const initialJavaScript = new Set(
    JavaScriptURLs.map((source) => path.join(output, source.replace(/^\/+/, ""))).filter(
      existsSync,
    ),
  );
  const initialGzipBytes = [...initialJavaScript].reduce(
    (total, file) => total + gzipSync(readFileSync(file)).byteLength,
    0,
  );
  if (initialGzipBytes > maximumInitialGzipBytes) {
    maximumInitialGzipBytes = initialGzipBytes;
    maximumInitialGzipPage = path.relative(output, htmlFile);
  }
  if (initialGzipBytes > maximumInitialJavaScriptKib * 1024) {
    throw new Error(
      `${path.relative(output, htmlFile)} loads ${(initialGzipBytes / 1024).toFixed(1)} KiB JavaScript gzip; budget is ${maximumInitialJavaScriptKib} KiB`,
    );
  }

  if (path.basename(htmlFile) !== "_shell.html") {
    const identifiers = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    for (const match of html.matchAll(/\bhref="#([^"]+)"/g)) {
      if (!identifiers.has(match[1])) {
        throw new Error(`${path.relative(output, htmlFile)} links to missing #${match[1]}`);
      }
    }
  }

  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/g)) {
    const href = match[1];
    if (!href || href.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
    const targetURL = new URL(href, pageURL(htmlFile));
    if (targetURL.origin !== "https://seekite.invalid") continue;
    const targetFile = outputForPath(targetURL.pathname);
    if (!targetFile) {
      throw new Error(
        `${path.relative(output, htmlFile)} links to missing page ${targetURL.pathname}`,
      );
    }
    checkedLinks += 1;
    if (targetURL.hash) {
      const targetHTML = htmlCache.get(targetFile) ?? readFileSync(targetFile, "utf8");
      const identifier = decodeURIComponent(targetURL.hash.slice(1));
      const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\bid="${escapedIdentifier}"`).test(targetHTML)) {
        throw new Error(
          `${path.relative(output, htmlFile)} links to missing ${targetURL.pathname}${targetURL.hash}`,
        );
      }
    }
  }
}

const searchFiles = files(path.join(output, "search"), "");
const searchBytes = searchFiles.reduce((total, file) => total + statSync(file).size, 0);
console.log(
  `Verified ${htmlFiles.length} static pages, ${checkedLinks} internal links, ${(maximumInitialGzipBytes / 1024).toFixed(1)} KiB maximum initial JS gzip (${maximumInitialGzipPage}), and ${(searchBytes / 1024).toFixed(1)} KiB search assets.`,
);
