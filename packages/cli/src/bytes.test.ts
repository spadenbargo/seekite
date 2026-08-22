import { describe, expect, it } from "vite-plus/test";
import { formatByteSize, parseByteSize } from "./bytes.js";

describe("cache byte sizes", () => {
  it("parses decimal and binary units", () => {
    expect(parseByteSize("500MB")).toBe(500_000_000);
    expect(parseByteSize("2 MiB")).toBe(2_097_152);
    expect(parseByteSize("128")).toBe(128);
  });

  it("rejects invalid and unsafe sizes", () => {
    expect(() => parseByteSize("large")).toThrow("Invalid byte size");
    expect(() => parseByteSize("999999999999999999999GB")).toThrow("outside the supported range");
  });

  it("formats human-readable decimal sizes", () => {
    expect(formatByteSize(24)).toBe("24 B");
    expect(formatByteSize(1_500_000)).toBe("1.5 MB");
  });
});
