import { Link } from "@tanstack/react-router";
import {
  Markdown,
  type MarkdownComponentProps,
  type MarkdownComponents,
} from "@tanstack/markdown/react";
import type { ElementType, ReactNode } from "react";
import { markdownExtensions, resolveMarkdownHref, type DocPage } from "./content";
import { markdownHighlighter } from "./highlight";

function MarkdownLink({
  currentSlug,
  href,
  children,
  className,
  title,
}: MarkdownComponentProps<"a"> & { currentSlug: string }) {
  const resolved = resolveMarkdownHref(currentSlug, href ?? "");
  const external = /^(?:https?:|mailto:)/i.test(resolved);
  if (external) {
    return (
      <a className={className} href={resolved} rel="noreferrer" target="_blank" title={title}>
        {children}
      </a>
    );
  }

  const [pathname, hash] = resolved.split("#", 2);
  if (pathname?.startsWith("/docs/")) {
    return (
      <Link
        className={className}
        to="/docs/$"
        params={{ _splat: pathname.slice("/docs/".length) }}
        hash={hash}
        title={title}
      >
        {children}
      </Link>
    );
  }
  return (
    <a className={className} href={resolved} title={title}>
      {children}
    </a>
  );
}

function linkedHeading(Tag: ElementType) {
  return function LinkedHeading({ id, children, ...props }: { id?: string; children?: ReactNode }) {
    return (
      <Tag {...props} id={id}>
        {id ? (
          <a className="heading-anchor" href={`#${id}`}>
            {children}
          </a>
        ) : (
          children
        )}
      </Tag>
    );
  };
}

const headings = {
  h1: linkedHeading("h1"),
  h2: linkedHeading("h2"),
  h3: linkedHeading("h3"),
  h4: linkedHeading("h4"),
  h5: linkedHeading("h5"),
  h6: linkedHeading("h6"),
};

export function DocMarkdown({ page }: { page: DocPage }) {
  const components: MarkdownComponents = {
    ...headings,
    a: (props) => <MarkdownLink {...props} currentSlug={page.slug} />,
    pre: (props) => <pre {...props} tabIndex={0} />,
  };

  return (
    <Markdown
      allowHtml={false}
      components={components}
      extensions={markdownExtensions}
      highlighter={markdownHighlighter}
    >
      {page.document}
    </Markdown>
  );
}
