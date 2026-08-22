import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("./dist/search/manifest.json", import.meta.url)),
);
const corpus = JSON.parse(
  await readFile(
    new URL(`./dist/search/${manifest.corpora.docs.path}/corpus.json`, import.meta.url),
  ),
);
assert.equal(corpus.documents.length, 2);
assert.ok(manifest.corpora.docs.chunks >= 2);
