import { describe, expect, it } from "vite-plus/test";
import { parseIndexFormat } from "./format.js";

describe("index format CLI values", () => {
  it("accepts both argv strings and CAC-normalized numbers", () => {
    expect(parseIndexFormat("1")).toBe(1);
    expect(parseIndexFormat(1)).toBe(1);
    expect(parseIndexFormat("2")).toBe(2);
    expect(parseIndexFormat(2)).toBe(2);
    expect(parseIndexFormat(undefined)).toBeUndefined();
  });

  it("rejects unsupported versions", () => {
    expect(() => parseIndexFormat(3)).toThrow(/expected 1 or 2/);
  });
});
