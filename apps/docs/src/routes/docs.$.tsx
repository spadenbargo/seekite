import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { DocMarkdown } from "../markdown";
import { docsBySection, getDoc } from "../content";

export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) => {
    // oxlint-disable-next-line eslint/no-underscore-dangle -- TanStack names its catch-all parameter `_splat`.
    const page = getDoc(params._splat);
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Documentation"} — Seekite` },
      { name: "description", content: loaderData?.description ?? "Seekite documentation" },
      { name: "data-seekite-section", content: loaderData?.section ?? "Guides" },
    ],
  }),
  component: DocumentationPage,
});

function DocumentationPage() {
  const page = Route.useLoaderData();
  return (
    <main id="main-content" className="docs-layout">
      <aside className="docs-sidebar" aria-label="Documentation navigation">
        {Object.entries(docsBySection).map(([section, pages]) => (
          <section key={section}>
            <h2>{section}</h2>
            <ul>
              {pages?.map((candidate) => (
                <li key={candidate.slug}>
                  <Link
                    to="/docs/$"
                    params={{ _splat: candidate.slug }}
                    activeProps={{ "aria-current": "page" }}
                  >
                    {candidate.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </aside>
      <article className="doc-article" data-seekite-body data-section={page.section}>
        <div className="doc-meta">
          <span>{page.section}</span>
          <a href={`https://github.com/spadenbargo/seekite/edit/main/${page.sourcePath}`}>
            Edit this page
          </a>
        </div>
        <DocMarkdown page={page} />
      </article>
      <nav className="on-this-page" aria-label="On this page">
        <h2>On this page</h2>
        <ol>
          {page.document.headings
            ?.filter((heading) => heading.level === 2 || heading.level === 3)
            .map((heading) => (
              <li key={heading.id} data-level={heading.level}>
                <a href={`#${heading.id}`}>{heading.text}</a>
              </li>
            ))}
        </ol>
      </nav>
    </main>
  );
}
