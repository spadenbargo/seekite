import { Fragment, createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SearchUIClient } from "./index.js";
import { SearchBox, SearchDialog, SeekiteProvider } from "./index.js";

function client(): SearchUIClient {
  return {
    load: vi.fn(async () => undefined),
    loaded: () => [],
    query: vi.fn(async () => ({ results: [], total: 0 })),
    warmup: vi.fn(async () => undefined),
  };
}

describe("@seekite/react server rendering", () => {
  it("renders a closed dialog and inline box without reading browser globals", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get: () => {
        throw new Error("window was read during SSR");
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      get: () => {
        throw new Error("document was read during SSR");
      },
    });

    try {
      const html = renderToString(
        createElement(
          SeekiteProvider,
          { client: client() },
          createElement(
            Fragment,
            null,
            createElement(SearchBox, { label: "Search docs" }),
            createElement(SearchDialog, { label: "Search documentation" }),
          ),
        ),
      );
      expect(html).toContain('role="combobox"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain('role="dialog"');
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
      if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });
});
