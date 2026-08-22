import { renderToString } from "@vue/server-renderer";
import { createSSRApp, defineComponent, h } from "vue";
import { describe, expect, it } from "vite-plus/test";
import type { SearchUIClient } from "@seekite/search-ui";
import { SeekiteSearchBox, createVitePressSearchController, withSeekiteSearch } from "./theme.js";

function fakeClient(): SearchUIClient {
  return {
    async load() {},
    loaded: () => [],
    async query() {
      return { results: [], total: 0 };
    },
    async warmup() {},
  };
}

describe("VitePress theme", () => {
  it("server-renders the real Vue combobox without touching browser globals", async () => {
    const controller = createVitePressSearchController({ client: fakeClient() });
    try {
      const app = createSSRApp({
        render: () =>
          h(SeekiteSearchBox, {
            controller,
            navigate: () => undefined,
            label: "Search the handbook",
          }),
      });
      const markup = await renderToString(app);
      expect(markup).toContain('role="combobox"');
      expect(markup).toContain('aria-label="Search the handbook"');
      expect(markup).toContain("seekite-vitepress-input");
    } finally {
      controller.destroy();
    }
  });

  it("wraps the default layout and fills its navigation search slot", async () => {
    const controller = createVitePressSearchController({ client: fakeClient() });
    const Layout = defineComponent({
      setup(_props, { slots }) {
        return () => h("nav", slots["nav-bar-content-before"]?.());
      },
    });
    try {
      const theme = withSeekiteSearch(
        { Layout },
        { controller, navigate: () => undefined, placeholder: "Find an integration" },
      );
      const app = createSSRApp({ render: () => h(theme.Layout) });
      const markup = await renderToString(app);
      expect(markup).toContain("Find an integration");
      expect(markup).toContain("seekite-vitepress-search");
    } finally {
      controller.destroy();
    }
  });
});
