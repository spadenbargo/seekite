import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type { ReactNode } from "react";
import seekiteCss from "@seekite/react/style.css?url";
import appCss from "../styles.css?url";
import { DocsSearchProvider } from "../components/site-search";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "description",
        content: "Seekite is compact, evidence-driven hybrid search for static sites.",
      },
      { title: "Seekite — static hybrid search" },
    ],
    links: [
      { rel: "stylesheet", href: seekiteCss },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  notFoundComponent: NotFoundPage,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider
          search={{ enabled: false }}
          theme={{
            attribute: "class",
            defaultTheme: "system",
            enableSystem: true,
            hotKey: false,
            storageKey: "seekite-theme",
          }}
        >
          <DocsSearchProvider>
            <a className="skip-link" href="#main-content">
              Skip to content
            </a>
            {children}
          </DocsSearchProvider>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundPage() {
  return (
    <main id="main-content" className="not-found">
      <p className="eyebrow">404</p>
      <h1>That page is not in the index.</h1>
      <p>
        <Link to="/">Return to the Seekite docs</Link> or use search to find a nearby topic.
      </p>
    </main>
  );
}
