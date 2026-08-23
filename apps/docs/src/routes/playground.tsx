import { createFileRoute } from "@tanstack/react-router";
import type { QueryResponse, SearchMode } from "@seekite/core";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useState, useTransition } from "react";
import { docsSearch } from "../search";
import { baseOptions } from "../lib/layout.shared";

export const Route = createFileRoute("/playground")({
  head: () => ({
    meta: [
      { title: "Search playground — Seekite" },
      {
        name: "description",
        content: "Compare lexical, semantic, and hybrid ranking against the Seekite docs corpus.",
      },
    ],
  }),
  component: PlaygroundPage,
});

const modes: SearchMode[] = ["lexical", "hybrid", "semantic"];

function PlaygroundPage() {
  const [query, setQuery] = useState("hybrid search");
  const [runs, setRuns] = useState<Partial<Record<SearchMode, QueryResponse>>>({});
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const compare = () => {
    setError(undefined);
    startTransition(async () => {
      try {
        const responses = await Promise.all(
          modes.map(
            async (mode) =>
              [
                mode,
                await docsSearch.query(query, {
                  corpora: ["docs"],
                  mode,
                  group: "document",
                  hydrate: true,
                  limit: 5,
                }),
              ] as const,
          ),
        );
        setRuns(Object.fromEntries(responses));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  return (
    <HomeLayout {...baseOptions()}>
      <section id="main-content" className="playground-page">
        <header>
          <p className="eyebrow">Read-only lab</p>
          <h1>Compare the rankers on real docs.</h1>
          <p>
            One corpus, three modes, no server calls. The same worker and format-v2 assets power the
            site-wide search dialog.
          </p>
        </header>
        <form
          className="compare-form"
          onSubmit={(event) => {
            event.preventDefault();
            compare();
          }}
        >
          <label htmlFor="compare-query">Query</label>
          <div>
            <input
              id="compare-query"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onFocus={() => void docsSearch.warmup()}
            />
            <button type="submit" disabled={pending || query.trim().length < 2}>
              {pending ? "Comparing…" : "Compare modes"}
            </button>
          </div>
        </form>
        {error ? <p role="alert">{error}</p> : null}
        <div className="comparison-grid" aria-live="polite">
          {modes.map((mode) => (
            <section key={mode}>
              <header>
                <h2>{mode}</h2>
                <span>{runs[mode] ? `${runs[mode]?.total ?? 0} matches` : "Run a query"}</span>
              </header>
              <ol>
                {runs[mode]?.results.map((result) => (
                  <li key={result.id}>
                    <a href={result.url}>
                      <strong>{result.title}</strong>
                      <span>{result.heading}</span>
                      <small>score {result.score.toFixed(3)}</small>
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </section>
    </HomeLayout>
  );
}
