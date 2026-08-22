import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("./docs/.vitepress/dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("search/manifest.json", root)));
const corpus = JSON.parse(
  await readFile(new URL(`search/${manifest.corpora.docs.path}/corpus.json`, root)),
);
assert.equal(corpus.documents.length, 2);
assert.match(await readFile(new URL("index.html", root), "utf8"), /Search fixture docs/);
