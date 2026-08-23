import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsPage, EditOnGitHub } from "fumadocs-ui/layouts/docs/page";
import { DocMarkdown } from "../markdown";
import { docsTree, getDoc } from "../content";
import { baseOptions, repositoryUrl } from "../lib/layout.shared";

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
  const toc =
    page.document.headings
      ?.filter((heading) => heading.level === 2 || heading.level === 3)
      .map((heading) => ({
        title: heading.text,
        url: `#${heading.id}`,
        depth: heading.level,
      })) ?? [];

  return (
    <DocsLayout {...baseOptions()} tree={docsTree} tabs={false} sidebar={{ defaultOpenLevel: 1 }}>
      <DocsPage id="main-content" toc={toc} breadcrumb={{ enabled: false }}>
        <DocsBody className="seekite-doc-body" data-seekite-body data-section={page.section}>
          <DocMarkdown page={page} />
          <EditOnGitHub href={`${repositoryUrl}/edit/main/${page.sourcePath}`}>
            Edit this page on GitHub
          </EditOnGitHub>
        </DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
