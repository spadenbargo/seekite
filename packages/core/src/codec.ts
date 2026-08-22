import type {
  DictionaryTermV2,
  LexicalDictionaryV2,
  LexicalIndex,
  LexicalIndexV2,
  LexicalPostingV2,
  VectorDType,
} from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const DICTIONARY_MAGIC = "SKDX";
const VECTOR_MAGIC = "SKVX";

export class SeekiteFormatError extends Error {
  override name = "SeekiteFormatError";
}

function bytesOf(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

class ByteWriter {
  readonly values: number[] = [];

  u8(value: number): void {
    this.values.push(value & 0xff);
  }

  u16(value: number): void {
    this.u8(value);
    this.u8(value >>> 8);
  }

  u32(value: number): void {
    this.u8(value);
    this.u8(value >>> 8);
    this.u8(value >>> 16);
    this.u8(value >>> 24);
  }

  f32(value: number): void {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, true);
    this.bytes(new Uint8Array(buffer));
  }

  varint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(`Invalid unsigned varint: ${value}`);
    let remaining = value;
    while (remaining >= 0x80) {
      this.u8((remaining % 0x80) | 0x80);
      remaining = Math.floor(remaining / 0x80);
    }
    this.u8(remaining);
  }

  bytes(value: Uint8Array): void {
    for (const byte of value) this.values.push(byte);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.values);
  }
}

class ByteReader {
  readonly data: Uint8Array;
  offset = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.data = bytesOf(data);
  }

  ensure(count: number): void {
    if (count < 0 || this.offset + count > this.data.byteLength)
      throw new SeekiteFormatError("Truncated Seekite binary payload");
  }

  u8(): number {
    this.ensure(1);
    return this.data[this.offset++]!;
  }

  u16(): number {
    this.ensure(2);
    const value = this.data[this.offset]! | (this.data[this.offset + 1]! << 8);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.ensure(4);
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(
      0,
      true,
    );
    this.offset += 4;
    return value;
  }

  f32(): number {
    this.ensure(4);
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getFloat32(
      0,
      true,
    );
    this.offset += 4;
    return value;
  }

  varint(): number {
    let value = 0;
    let multiplier = 1;
    for (let count = 0; count < 10; count += 1) {
      const byte = this.u8();
      value += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(value))
        throw new SeekiteFormatError("Seekite varint exceeds the safe integer range");
      if ((byte & 0x80) === 0) return value;
      multiplier *= 0x80;
    }
    throw new SeekiteFormatError("Seekite varint is too long");
  }

  bytes(count: number): Uint8Array {
    this.ensure(count);
    const value = this.data.subarray(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }

  done(): boolean {
    return this.offset === this.data.byteLength;
  }
}

function writeMagic(writer: ByteWriter, magic: string): void {
  writer.bytes(encoder.encode(magic));
}

function expectMagic(reader: ByteReader, magic: string): void {
  let actual: string;
  try {
    actual = decoder.decode(reader.bytes(4));
  } catch {
    throw new SeekiteFormatError("Invalid UTF-8 in Seekite binary magic");
  }
  if (actual !== magic)
    throw new SeekiteFormatError(
      `Invalid Seekite binary magic: expected ${magic}, received ${actual}`,
    );
}

export function encodeLexicalIndex(index: LexicalIndex): Uint8Array {
  return encoder.encode(JSON.stringify(index));
}

export function decodeLexicalIndex(data: ArrayBuffer | Uint8Array): LexicalIndex {
  try {
    const value = JSON.parse(decoder.decode(bytesOf(data))) as Partial<LexicalIndex>;
    if (value.version !== 1 || !value.postings || !Array.isArray(value.lengths)) {
      throw new SeekiteFormatError("Invalid Seekite format-v1 lexical index");
    }
    return value as LexicalIndex;
  } catch (error) {
    if (error instanceof SeekiteFormatError) throw error;
    throw new SeekiteFormatError(
      `Unable to decode Seekite format-v1 lexical index: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function encodePostings(postings: LexicalPostingV2[]): Uint8Array {
  const writer = new ByteWriter();
  writer.varint(postings.length);
  let previous = 0;
  for (const posting of postings) {
    if (posting.chunk < previous)
      throw new RangeError("Lexical postings must be sorted by chunk index");
    writer.varint(posting.chunk - previous);
    writer.varint(posting.frequencies[0]);
    writer.varint(posting.frequencies[1]);
    writer.varint(posting.frequencies[2]);
    previous = posting.chunk;
  }
  return writer.finish();
}

export interface EncodedLexicalV2 {
  dictionary: Uint8Array;
  shards: Uint8Array[];
}

export function encodeLexicalV2(
  index: LexicalIndexV2,
  targetShardBytes = 64 * 1024,
): EncodedLexicalV2 {
  if (index.version !== 2) throw new RangeError("Expected a format-v2 lexical index");
  const shardTarget = Math.max(1, Math.floor(targetShardBytes));
  const shardParts: Uint8Array[][] = [[]];
  const shardLengths = [0];
  const definitions: DictionaryTermV2[] = [];

  for (const entry of index.terms) {
    const encoded = encodePostings(entry.postings);
    let shard = shardParts.length - 1;
    if (shardLengths[shard]! > 0 && shardLengths[shard]! + encoded.byteLength > shardTarget) {
      shardParts.push([]);
      shardLengths.push(0);
      shard += 1;
    }
    const offset = shardLengths[shard]!;
    shardParts[shard]!.push(encoded);
    shardLengths[shard] = offset + encoded.byteLength;
    definitions.push({ term: entry.term, documentFrequency: entry.postings.length, shard, offset });
  }
  if (index.terms.length === 0) {
    shardParts.length = 0;
    shardLengths.length = 0;
  }

  const dictionary = new ByteWriter();
  writeMagic(dictionary, DICTIONARY_MAGIC);
  dictionary.u16(2);
  dictionary.u16(0);
  dictionary.u8(3);
  dictionary.varint(index.documentCount);
  index.averageFieldLengths.forEach((value) => dictionary.f32(value));
  for (const lengths of index.fieldLengths) for (const value of lengths) dictionary.varint(value);
  dictionary.varint(definitions.length);
  let previous = new Uint8Array();
  for (const definition of definitions) {
    const term = encoder.encode(definition.term);
    let shared = 0;
    while (shared < previous.length && shared < term.length && previous[shared] === term[shared])
      shared += 1;
    const suffix = term.subarray(shared);
    dictionary.varint(shared);
    dictionary.varint(suffix.byteLength);
    dictionary.bytes(suffix);
    dictionary.varint(definition.documentFrequency);
    dictionary.varint(definition.shard);
    dictionary.varint(definition.offset);
    previous = term;
  }
  dictionary.varint(shardLengths.length);
  shardLengths.forEach((length) => dictionary.varint(length));

  return {
    dictionary: dictionary.finish(),
    shards: shardParts.map((parts, index_) => {
      const output = new Uint8Array(shardLengths[index_]!);
      let offset = 0;
      for (const part of parts) {
        output.set(part, offset);
        offset += part.byteLength;
      }
      return output;
    }),
  };
}

export function decodeDictionaryV2(data: ArrayBuffer | Uint8Array): LexicalDictionaryV2 {
  const reader = new ByteReader(data);
  expectMagic(reader, DICTIONARY_MAGIC);
  if (reader.u16() !== 2)
    throw new SeekiteFormatError("Unsupported Seekite lexical dictionary version");
  reader.u16(); // flags, reserved in v2
  if (reader.u8() !== 3)
    throw new SeekiteFormatError("Seekite format v2 requires exactly three lexical fields");
  const documentCount = reader.varint();
  const averageFieldLengths: LexicalDictionaryV2["averageFieldLengths"] = [
    reader.f32(),
    reader.f32(),
    reader.f32(),
  ];
  const fieldLengths: LexicalDictionaryV2["fieldLengths"] = [[], [], []];
  for (const lengths of fieldLengths)
    for (let index = 0; index < documentCount; index += 1) lengths.push(reader.varint());
  const termCount = reader.varint();
  const terms: DictionaryTermV2[] = [];
  let previous = new Uint8Array();
  for (let index = 0; index < termCount; index += 1) {
    const shared = reader.varint();
    const suffixLength = reader.varint();
    if (shared > previous.byteLength)
      throw new SeekiteFormatError("Invalid front-coded dictionary prefix length");
    const termBytes = new Uint8Array(shared + suffixLength);
    termBytes.set(previous.subarray(0, shared));
    termBytes.set(reader.bytes(suffixLength), shared);
    let term: string;
    try {
      term = decoder.decode(termBytes);
    } catch {
      throw new SeekiteFormatError("Invalid UTF-8 in Seekite lexical dictionary");
    }
    terms.push({
      term,
      documentFrequency: reader.varint(),
      shard: reader.varint(),
      offset: reader.varint(),
    });
    previous = termBytes;
  }
  const shardCount = reader.varint();
  const shardByteLengths = Array.from({ length: shardCount }, () => reader.varint());
  if (!reader.done())
    throw new SeekiteFormatError("Unexpected trailing data in Seekite lexical dictionary");
  for (let index = 1; index < terms.length; index += 1) {
    if (terms[index - 1]!.term >= terms[index]!.term)
      throw new SeekiteFormatError("Seekite lexical dictionary is not strictly sorted");
  }
  for (const term of terms) {
    if (term.shard >= shardCount || term.offset >= (shardByteLengths[term.shard] ?? 0)) {
      throw new SeekiteFormatError("Seekite lexical dictionary points outside a postings shard");
    }
  }
  return { version: 2, documentCount, averageFieldLengths, fieldLengths, terms, shardByteLengths };
}

export function decodePostingsV2(
  data: ArrayBuffer | Uint8Array,
  offset: number,
  expectedCount: number,
  documentCount?: number,
): LexicalPostingV2[] {
  const reader = new ByteReader(data);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= reader.data.byteLength) {
    throw new SeekiteFormatError("Seekite postings offset is outside the shard");
  }
  reader.offset = offset;
  const count = reader.varint();
  if (count !== expectedCount)
    throw new SeekiteFormatError(
      `Seekite postings count mismatch: expected ${expectedCount}, received ${count}`,
    );
  const postings: LexicalPostingV2[] = [];
  let chunk = 0;
  for (let index = 0; index < count; index += 1) {
    const delta = reader.varint();
    if (index > 0 && delta === 0)
      throw new SeekiteFormatError("Seekite postings must reference strictly increasing chunks");
    chunk += delta;
    if (documentCount !== undefined && chunk >= documentCount)
      throw new SeekiteFormatError("Seekite posting references an unknown chunk");
    const frequencies: LexicalPostingV2["frequencies"] = [
      reader.varint(),
      reader.varint(),
      reader.varint(),
    ];
    if (frequencies.every((frequency) => frequency === 0)) {
      throw new SeekiteFormatError("Seekite posting has no term frequency");
    }
    postings.push({ chunk, frequencies });
  }
  return postings;
}

export function encodeVectors(vectors: Float32Array[], dimensions: number): Uint8Array {
  const output = new Uint8Array(vectors.length * dimensions * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(output.buffer);
  vectors.forEach((vector, index) => {
    if (vector.length !== dimensions)
      throw new Error(`Expected ${dimensions} embedding dimensions, received ${vector.length}`);
    vector.forEach((value, dimension) =>
      view.setFloat32((index * dimensions + dimension) * 4, value, true),
    );
  });
  return output;
}

export function decodeVectors(data: ArrayBuffer | Uint8Array, dimensions: number): Float32Array[] {
  const bytes = bytesOf(data);
  if (dimensions <= 0 || bytes.byteLength % (dimensions * 4) !== 0)
    throw new SeekiteFormatError("Invalid Seekite vector data length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vectors: Float32Array[] = [];
  for (let offset = 0; offset < bytes.byteLength / 4; offset += dimensions) {
    const vector = new Float32Array(dimensions);
    for (let dimension = 0; dimension < dimensions; dimension += 1)
      vector[dimension] = view.getFloat32((offset + dimension) * 4, true);
    vectors.push(vector);
  }
  return vectors;
}

export interface DecodedVectorsV2 {
  version: 2;
  dtype: VectorDType;
  dimensions: number;
  count: number;
  scales?: Float32Array;
  values: Float32Array | Int8Array;
}

function normalized(vector: Float32Array): Float32Array {
  let squared = 0;
  for (const value of vector) squared += value * value;
  const magnitude = Math.sqrt(squared) || 1;
  return Float32Array.from(vector, (value) => value / magnitude);
}

export function encodeVectorsV2(
  vectors: Float32Array[],
  dimensions: number,
  dtype: VectorDType = "i8",
): Uint8Array {
  for (const vector of vectors)
    if (vector.length !== dimensions)
      throw new Error(`Expected ${dimensions} embedding dimensions, received ${vector.length}`);
  const headerBytes = 16;
  const output = new Uint8Array(
    headerBytes +
      (dtype === "f32"
        ? vectors.length * dimensions * 4
        : vectors.length * 4 + vectors.length * dimensions),
  );
  const view = new DataView(output.buffer);
  output.set(encoder.encode(VECTOR_MAGIC), 0);
  view.setUint16(4, 2, true);
  view.setUint8(6, dtype === "f32" ? 0 : 1);
  view.setUint8(7, 0);
  view.setUint32(8, dimensions, true);
  view.setUint32(12, vectors.length, true);
  if (dtype === "f32") {
    let offset = headerBytes;
    for (const vector of vectors)
      for (const value of vector) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
  } else {
    const quantized: Int8Array[] = [];
    vectors.forEach((source, index) => {
      const vector = normalized(source);
      let maximum = 0;
      for (const value of vector) maximum = Math.max(maximum, Math.abs(value));
      const scale = maximum / 127 || 1 / 127;
      view.setFloat32(headerBytes + index * 4, scale, true);
      quantized.push(
        Int8Array.from(vector, (value) => Math.max(-127, Math.min(127, Math.round(value / scale)))),
      );
    });
    let offset = headerBytes + vectors.length * 4;
    for (const vector of quantized) {
      output.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength), offset);
      offset += vector.byteLength;
    }
  }
  return output;
}

export function decodeVectorsV2(
  data: ArrayBuffer | Uint8Array,
  expectedDimensions?: number,
): DecodedVectorsV2 {
  const reader = new ByteReader(data);
  expectMagic(reader, VECTOR_MAGIC);
  if (reader.u16() !== 2) throw new SeekiteFormatError("Unsupported Seekite vector version");
  const dtypeCode = reader.u8();
  reader.u8();
  if (dtypeCode !== 0 && dtypeCode !== 1)
    throw new SeekiteFormatError(`Unsupported Seekite vector dtype: ${dtypeCode}`);
  const dimensions = reader.u32();
  const count = reader.u32();
  if (dimensions === 0 || (expectedDimensions !== undefined && dimensions !== expectedDimensions)) {
    throw new SeekiteFormatError(
      `Seekite vector dimensions mismatch: expected ${expectedDimensions ?? "> 0"}, received ${dimensions}`,
    );
  }
  const dtype: VectorDType = dtypeCode === 0 ? "f32" : "i8";
  const expectedBytes =
    count * dimensions * (dtype === "f32" ? 4 : 1) + (dtype === "i8" ? count * 4 : 0);
  if (reader.data.byteLength - reader.offset !== expectedBytes)
    throw new SeekiteFormatError("Invalid Seekite format-v2 vector data length");
  if (dtype === "f32") {
    const values = new Float32Array(count * dimensions);
    for (let index = 0; index < values.length; index += 1) values[index] = reader.f32();
    return { version: 2, dtype, dimensions, count, values };
  }
  const scales = new Float32Array(count);
  for (let index = 0; index < count; index += 1) scales[index] = reader.f32();
  const raw = reader.bytes(count * dimensions);
  const values = new Int8Array(raw.byteLength);
  new Uint8Array(values.buffer).set(raw);
  return { version: 2, dtype, dimensions, count, scales, values };
}

export function vectorSimilarity(
  vectors: DecodedVectorsV2,
  row: number,
  query: Float32Array,
): number {
  if (query.length !== vectors.dimensions || row < 0 || row >= vectors.count)
    throw new RangeError("Vector row or query dimensions are invalid");
  const start = row * vectors.dimensions;
  let dot = 0;
  let rowSquared = 0;
  let querySquared = 0;
  if (vectors.dtype === "f32") {
    const values = vectors.values as Float32Array;
    for (let dimension = 0; dimension < vectors.dimensions; dimension += 1) {
      const left = values[start + dimension] ?? 0;
      const right = query[dimension] ?? 0;
      dot += left * right;
      rowSquared += left * left;
      querySquared += right * right;
    }
  } else {
    const values = vectors.values as Int8Array;
    const scale = vectors.scales?.[row] ?? 1;
    for (let dimension = 0; dimension < vectors.dimensions; dimension += 1) {
      const left = (values[start + dimension] ?? 0) * scale;
      const right = query[dimension] ?? 0;
      dot += left * right;
      rowSquared += left * left;
      querySquared += right * right;
    }
  }
  return dot / (Math.sqrt(rowSquared) * Math.sqrt(querySquared) || 1);
}
