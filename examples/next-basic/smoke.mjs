import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("./out/search/manifest.json", import.meta.url)));
const corpus = JSON.parse(
  await readFile(
    new URL(`./out/search/${manifest.corpora.docs.path}/corpus.json`, import.meta.url),
  ),
);
assert.equal(corpus.documents.length, 2);
assert.match(
  await readFile(new URL("./out/guide.html", import.meta.url), "utf8"),
  /Next export guide/,
);
