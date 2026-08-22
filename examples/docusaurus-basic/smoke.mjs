import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./build/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("search/manifest.json", root)));
const corpus = JSON.parse(
  await readFile(new URL(`search/${manifest.corpora.docs.path}/corpus.json`, root)),
);
assert.equal(corpus.documents.length, 2);
const html = await readFile(new URL("index.html", root), "utf8");
assert.match(html, /seekite-search-url/);
assert.match(html, /Search documentation/);
