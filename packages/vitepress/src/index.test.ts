import { describe, expect, it } from "vite-plus/test";
import { seekite, vitePressLocaleConfig, withSeekite } from "./index.js";

describe("VitePress integration", () => {
  it("wraps the Vite plugin with VitePress defaults", () => {
    expect(seekite()).toMatchObject({ name: "seekite", enforce: "post" });
  });

  it("creates route-filtered locale corpora", () => {
    const config = vitePressLocaleConfig({ root: {}, fr: {}, "zh-CN": {} });
    expect(config.corpora.root?.exclude).toEqual(["/fr", "/fr/**", "/zh-CN", "/zh-CN/**"]);
    expect(config.corpora.fr?.include).toEqual(["/fr", "/fr/**"]);
    expect(config.corpora["zh-CN"]?.facets).toEqual(["locale"]);
  });

  it("composes VitePress buildEnd after existing Vite plugins", () => {
    const existing = { name: "existing" };
    const config = withSeekite({ vite: { plugins: [existing] } });

    expect(config.vite?.plugins).toHaveLength(2);
    expect(config.vite?.plugins?.[0]).toBe(existing);
    expect(config.vite?.plugins?.[1]).toMatchObject({ name: "seekite", closeBundle: undefined });
    expect(config.buildEnd).toBeTypeOf("function");
  });
});
