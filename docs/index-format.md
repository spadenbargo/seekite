---
title: Portable index format
section: Guides
order: 60
---

# Portable index format

Current format version: **2**. All binary integers are little-endian. Unless a
fixed width is named, unsigned integers use LEB128 varints. Readers must reject
unknown magics, versions, truncated values, invalid offsets, and count or
dimension mismatches.

```text
search/
  manifest.json
  docs/
    corpus.json
    lexical/
      dictionary.bin
      postings-000.bin
    content/
      content-000.json
    vectors.bin             # optional
```

Paths in a corpus manifest are relative to that corpus directory, so the whole
`search/` tree can be hosted under any origin or base path.

## Manifest

The root JSON object contains `format: "seekite"`, `version: 2`, `generatedAt`,
and a `corpora` map. Each corpus records:

```json
{
  "name": "docs",
  "path": "docs",
  "chunks": 123,
  "format": 2,
  "corpus": "corpus.json",
  "lexical": { "dictionary": "lexical/dictionary.bin", "shards": 4 },
  "content": { "prefix": "content/content-", "shards": 2 },
  "vectors": { "file": "vectors.bin", "dtype": "i8" },
  "embedding": {
    "provider": "seekite:ternlight:mini:v1",
    "dimensions": 384,
    "mode": "static"
  },
  "analyzer": { "folding": true, "stemmer": null }
}
```

`vectors` is absent when vectors are disabled or generated at runtime.
`embedding` is absent only for lexical-only corpora. A stemmer is `"en"`,
`"custom:<stable-id>"`, or `null`.

## `corpus.json`

The scored metadata is column-oriented. `documents` contains unique source
document IDs; `chunks.document` indexes that array. Every other chunk array is
parallel and has exactly `chunks` entries.

```json
{
  "version": 2,
  "name": "docs",
  "documents": ["getting-started"],
  "chunks": {
    "id": ["abc123"],
    "document": [0],
    "url": ["/getting-started#install"],
    "title": ["Getting started"],
    "heading": ["Install"],
    "content": [[0, 0]],
    "filters": { "tags": [["vite"]] }
  },
  "facets": { "tags": { "vite": 1 } }
}
```

Each `content` pair is `[shardIndex, indexInShard]`. Only declared filter and
facet fields remain in the scored payload; display-only metadata lives with
the content.

## Lexical dictionary

`lexical/dictionary.bin` is always loaded. Its byte layout is:

```text
"SKDX"                    4-byte magic
2                         u16 format version
flags                     u16, zero in v2
3                         u8 field count: title, heading, body
chunkCount                varint
averageFieldLength        f32 × 3
fieldLengths              varint × 3 × chunkCount, field-major
termCount                 varint
terms                     repeated termCount times
shardCount                varint
shardByteLengths          varint × shardCount
```

Terms are strictly sorted and UTF-8 front-coded. One term record is:

```text
sharedPrefixBytes         varint
suffixBytes               varint
suffix                    UTF-8 bytes
documentFrequency         varint
postingsShard             varint
postingsOffset            varint
```

The prefix length is a byte count into the previous term's UTF-8 encoding.

## Postings shards

`lexical/postings-NNN.bin` files are targeted at 64 KiB. The dictionary points
directly to each term entry:

```text
postingCount              varint
repeat postingCount:
  chunkIndexDelta         varint
  titleTermFrequency      varint
  headingTermFrequency    varint
  bodyTermFrequency       varint
```

Chunk indices are ascending and delta-coded from zero. Per-field frequencies
let consumers apply BM25F field weights at query time.

## Content shards

`content/content-NNN.json` files target 128 KiB before compression:

```json
{
  "version": 2,
  "chunks": [{ "content": "Plain text", "metadata": { "author": "Ada" } }]
}
```

Only result pages selected for hydration need these files.

## Vector file

```text
"SKVX"                    4-byte magic
2                         u16 format version
dtype                     u8: 0 = f32, 1 = i8
reserved                  u8, zero
dimensions                u32
rowCount                  u32
payload
```

For f32, the payload is `rowCount × dimensions` little-endian float32 values.
For i8, it is `rowCount` float32 scales followed by signed int8 rows. A value is
approximately `scale[row] × int8Value`. Builders L2-normalize each row before
quantizing. Static vectors default to i8; use
`staticVectors(provider, { quantize: "f32" })` when exact f32 output is needed.

## Measured repository baseline

The committed docs corpus currently produces 32 chunks. A warm, native-backed
build embeds zero texts and gives the following format comparison:

| Artifact | v1 raw | v2 raw | v1 gzip | v2 gzip |
| --- | ---: | ---: | ---: | ---: |
| Vectors | 49,152 B | 12,432 B | 45,540 B | 11,558 B |
| Lexical | 35,698 B | 21,781 B | 9,260 B | 9,821 B |

Int8 rows make vectors about 3.95× smaller. The richer v2 lexical payload is
1.64× smaller before transport compression, but its field statistics and
prefix/fuzzy dictionary make this small corpus 6% larger under gzip. That
tradeoff is recorded rather than presenting the original 2× gzip target as a
measured result; larger-corpus deltas stay visible through `seekite bench`.

## Legacy version 1

Core 0.2 reads version 1 for one compatibility cycle, and the builder can emit
it with `seekite build --format 1`. Its corpus contains `metadata.json`, a
UTF-8 JSON `lexical.bin`, and an optional headerless little-endian f32
`vectors.bin`. Version 1 stores complete chunk objects and a single term
frequency per posting, so it cannot provide lazy content, BM25F, prefix/fuzzy
dictionary expansion, or quantized vectors. Version 1 write support is removed
at 1.0.
