// Benchmark the same worker entry and static index used by the docs application.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { cpus, release, tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { build } from "vite";

if (process.env.BENCH_CDP && !process.env.BENCH_DEVICE) {
  throw new Error("Set BENCH_DEVICE to the connected device model and OS.");
}
const app = path.resolve(import.meta.dirname, "..");
const out = await mkdtemp(path.join(tmpdir(), "seekite-browser-"));
const queries = ["hybrid search", "worker", "embedding provider", "filters", "install"];
const files = new Map();
const indexHash = createHash("sha256");
async function register(root, prefix) {
  for (const name of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(root, name.name);
    const url = prefix + "/" + name.name;
    if (name.isDirectory()) await register(full, url);
    else {
      const data = await readFile(full);
      if (prefix.startsWith("/search")) indexHash.update(url).update(data);
      files.set(url, gzipSync(data));
    }
  }
}
const shell = "/docs/search-quality";
const html = gzipSync(
  '<!doctype html><title>Seekite benchmark</title><link rel="icon" href="data:,">',
);
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
let bytes;
let measuringApp = false;
const server = createServer((req, res) => {
  const url = req.url;
  const payload = url === "/" ? html : files.get(url === shell ? shell + "/index.html" : url);
  if (!payload) {
    res.writeHead(404).end();
    return;
  }
  const category = measuringApp
    ? "app"
    : url === "/"
      ? "harness"
      : url.startsWith("/search/")
        ? "index"
        : url.endsWith(".wasm")
          ? "modelAndWasm"
          : "runtimeJS";
  bytes[category] += payload.length;
  res.writeHead(200, {
    "Content-Type":
      url === "/" || url === shell
        ? "text/html"
        : (mime[path.extname(url)] ?? "application/octet-stream"),
    "Content-Encoding": "gzip",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  res.end(payload);
});
let browser;
try {
  await build({
    root: app,
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    worker: { format: "es" },
    build: {
      outDir: out,
      emptyOutDir: true,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: path.join(app, "src/search.ts"),
        preserveEntrySignatures: "strict",
        output: { entryFileNames: "client.js" },
      },
    },
  });
  await register(path.join(app, "dist/client"), "");
  await register(out, "");

  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(Number(process.env.BENCH_PORT ?? 0), "127.0.0.1", resolve),
  );
  browser = process.env.BENCH_CDP
    ? await chromium.connectOverCDP(process.env.BENCH_CDP)
    : await chromium.launch();
  const openPage = () =>
    process.env.BENCH_CDP ? browser.contexts()[0].newPage() : browser.newPage();
  const report = {
    date: new Date().toISOString(),
    device: process.env.BENCH_DEVICE ?? cpus()[0].model,
    hostOS: release(),
    browser: browser.version(),
    indexSHA256: indexHash.digest("hex"),
    queries,
    runs: [],
  };
  measuringApp = true;
  bytes = { app: 0 };
  const shellPage = await openPage();
  try {
    await shellPage.goto(`http://127.0.0.1:${server.address().port}${shell}`, {
      waitUntil: "networkidle",
    });
    assert.ok(
      await shellPage.getByRole("heading", { name: "Search quality", exact: true }).count(),
    );
    report.docsPageGzipBodyBytes = bytes.app;
  } finally {
    await shellPage.close();
  }
  measuringApp = false;
  for (const mode of ["lexical", "hybrid"]) {
    for (let trial = 0; trial < 5; trial++) {
      bytes = { harness: 0, runtimeJS: 0, index: 0, modelAndWasm: 0 };
      const page = await openPage();
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const coldMs = await page.evaluate(
          async ({ mode, queries }) => {
            const start = performance.now();
            const { docsSearch } = await import("/client.js");
            async function query(text) {
              const response = await docsSearch.query(text, { corpora: ["docs"], mode, limit: 5 });
              if (!response.total) throw new Error("No hits for " + text);
            }
            await query(queries[0]);
            window.benchQuery = query;
            return performance.now() - start;
          },
          { mode, queries },
        );
        const coldBytes = { ...bytes };
        const warmMs = await page.evaluate(async (queries) => {
          const query = window.benchQuery;
          for (const text of queries) await query(text);
          const warmMs = [];
          for (let i = 0; i < 30; i++) {
            const before = performance.now();
            await query(queries[i % queries.length]);
            warmMs.push(performance.now() - before);
          }
          return warmMs;
        }, queries);
        assert.ok(bytes.runtimeJS && bytes.index);
        assert.equal(bytes.modelAndWasm > 0, mode === "hybrid");
        report.runs.push({
          mode,
          coldMs,
          warmMs,
          coldGzipBodyBytes: coldBytes,
          totalGzipBodyBytes: { ...bytes },
        });
      } finally {
        await page.close();
      }
    }
  }
  const percentile = (samples, fraction) =>
    samples.toSorted((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1];
  report.summary = ["lexical", "hybrid"].map((mode) => {
    const runs = report.runs.filter((run) => run.mode === mode);
    return {
      mode,
      coldMedianMs: percentile(
        runs.map((run) => run.coldMs),
        0.5,
      ),
      warmP95Ms: percentile(
        runs.flatMap((run) => run.warmMs),
        0.95,
      ),
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.close();
  await rm(out, { recursive: true, force: true });
}
