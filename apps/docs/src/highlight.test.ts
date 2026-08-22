import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { markdownHighlighter } from "./highlight";

describe("documentation highlighting", () => {
  it("emits token classes that are styled by the documentation theme", () => {
    const markup = markdownHighlighter('const answer = "seekite"', "ts");
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(markup).toContain('class="th-token th-keyword"');
    expect(markup).toContain('class="th-token th-string"');
    expect(styles).toMatch(/\.th-keyword[\s,]/);
    expect(styles).toMatch(/\.th-string[\s,]/);
    expect(styles).not.toContain(".th-token-keyword");
  });
});
