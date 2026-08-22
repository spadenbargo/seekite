// @vitest-environment jsdom

import { Fragment, StrictMode, act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SearchController, SearchUIClient, SearchUIState, SeekiteResult } from "./index.js";
import { SearchBox, SearchDialog, SeekiteProvider, useSeekite } from "./index.js";

type QueryResponse = NonNullable<SearchUIState["response"]>;

function result(id: string, corpus = "docs"): SeekiteResult {
  return {
    id,
    documentId: id,
    url: `/${id}`,
    title: `Result ${id}`,
    heading: `Heading ${id}`,
    content: `Use the canvas ${id} drawing API`,
    corpus,
    score: 1,
    lexicalScore: 1,
    terms: [{ term: "canvas", source: "canvas", kind: "exact" }],
    metadata: { tags: ["vite"] },
    document: { id, matches: 1 },
  };
}

function response(): QueryResponse {
  return {
    results: [result("a"), result("b", "api")],
    total: 2,
    facets: { tags: { vite: 2, astro: 1 } },
  };
}

function fakeClient(): SearchUIClient & {
  query: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  warmup: ReturnType<typeof vi.fn>;
} {
  const loaded = new Set<string>();
  const load = vi.fn(async (corpus: string) => {
    loaded.add(corpus);
  });
  return {
    load,
    loaded: () => [...loaded],
    query: vi.fn(async () => response()),
    warmup: vi.fn(async () => undefined),
  };
}

function Capture({ capture }: { capture: (controller: SearchController) => void }) {
  const [, controller] = useSeekite();
  capture(controller);
  return null;
}

function dispatchInput(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply supplies the input receiver.
  if (descriptor?.set) Reflect.apply(descriptor.set, input, [value]);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function runImmediateSearch(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
}

function key(target: EventTarget, value: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("@seekite/react interactions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.innerHTML = "";
    document.body.style.overflow = "";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await Promise.resolve();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("implements combobox, grouped-listbox, facets, live status, and keyboard selection", async () => {
    const client = fakeClient();
    const selected = vi.fn();
    let controller: SearchController | undefined;
    const children: ReactNode = createElement(
      Fragment,
      null,
      createElement(Capture, { capture: (value) => (controller = value) }),
      createElement(SearchBox, {
        label: "Search docs",
        onResultSelect: selected,
      }),
    );

    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            SeekiteProvider,
            { client, options: { debounceMs: 0, queryOptions: { facets: ["tags"] } } },
            children,
          ),
        ),
      ),
    );

    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(input.getAttribute("aria-label")).toBe("Search docs");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => input.focus());
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(client.warmup).toHaveBeenCalledTimes(1);

    await act(async () => dispatchInput(input, "canvas"));
    await runImmediateSearch();

    const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!;
    const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(listbox.id).toBe(input.getAttribute("aria-controls"));
    expect(host.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("2 results");
    expect(host.querySelector("mark")?.textContent?.toLocaleLowerCase()).toBe("canvas");

    const facet = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("vite"),
    )!;
    expect(facet.getAttribute("aria-pressed")).toBe("false");
    await act(async () => facet.click());
    await runImmediateSearch();
    expect(client.query.mock.calls.at(-1)?.[1]).toMatchObject({
      where: { tags: { in: ["vite"] } },
    });
    const activeFacet = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("vite"),
    );
    expect(activeFacet?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => key(input, "ArrowDown"));
    const refreshedOptions = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(input.getAttribute("aria-activedescendant")).toBe(refreshedOptions[1]?.id);
    await act(async () => key(input, "Enter"));
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(controller?.getState().recent).toEqual(["canvas"]);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the portal with Ctrl/Cmd+K, traps and restores focus, and removes its shortcut", async () => {
    const client = fakeClient();
    let controller: SearchController | undefined;
    const trigger = createElement(
      "button",
      { type: "button", id: "before-search" },
      "Before search",
    );
    await act(async () =>
      root.render(
        createElement(
          SeekiteProvider,
          { client, options: { debounceMs: 0 } },
          createElement(
            Fragment,
            null,
            trigger,
            createElement(Capture, {
              capture: (value) => (controller = value),
            }),
            createElement(SearchDialog, { label: "Search documentation" }),
          ),
        ),
      ),
    );

    const before = host.querySelector<HTMLButtonElement>("#before-search")!;
    before.focus();
    let shortcut!: KeyboardEvent;
    await act(async () => {
      shortcut = key(window, "k", { ctrlKey: true });
    });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!;
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close search"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe(
      "Search documentation",
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(input);

    await act(async () => key(input, "Tab"));
    expect(document.activeElement).toBe(close);
    await act(async () => key(close, "Tab", { shiftKey: true }));
    expect(document.activeElement).toBe(input);

    await act(async () => dispatchInput(input, "canvas"));
    await runImmediateSearch();
    await act(async () => key(input, "Escape"));
    expect(controller?.getState()).toMatchObject({ open: true, query: "" });
    await act(async () => key(input, "Escape"));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(before);

    await act(async () => root.unmount());
    await Promise.resolve();
    const afterUnmount = key(window, "k", { metaKey: true });
    expect(afterUnmount.defaultPrevented).toBe(false);
    const snapshot = controller?.getState();
    controller?.open();
    expect(controller?.getState()).toBe(snapshot);

    root = createRoot(host);
  });

  it("renders untrusted result fields as text instead of executable markup", async () => {
    const malicious = {
      ...result("unsafe"),
      title: '<img src="x" onerror="globalThis.__seekiteXss = true">',
      content: "<script>globalThis.__seekiteXss = true</script> canvas",
    };
    const client = fakeClient();
    client.query.mockResolvedValue({ results: [malicious], total: 1, facets: {} });

    await act(async () =>
      root.render(
        createElement(
          SeekiteProvider,
          { client, options: { debounceMs: 0 } },
          createElement(SearchBox, { label: "Search docs" }),
        ),
      ),
    );

    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () => input.focus());
    await act(async () => dispatchInput(input, "canvas"));
    await runImmediateSearch();

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("<img");
    expect(host.textContent).toContain("<script>");
    expect((globalThis as { __seekiteXss?: boolean }).__seekiteXss).toBeUndefined();
  });
});
