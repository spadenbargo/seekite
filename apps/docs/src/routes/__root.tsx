import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { GitFork } from "lucide-react";
import type { ReactNode } from "react";
import seekiteCss from "@seekite/react/style.css?url";
import appCss from "../styles.css?url";
import { DocsSearchProvider, SearchTrigger } from "../components/site-search";
import { ThemeProvider, themeScript } from "../components/theme-provider";
import { ThemeToggle } from "../components/theme-toggle";

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
  notFoundComponent: () => (
    <main className="not-found">
      <p className="eyebrow">404</p>
      <h1>That page is not in the index.</h1>
      <p>
        <Link to="/">Return to the Seekite docs</Link> or use search to find a nearby topic.
      </p>
    </main>
  ),
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <DocsSearchProvider>
            <a className="skip-link" href="#main-content">
              Skip to content
            </a>
            <header className="site-header">
              <div className="header-inner">
                <Link className="wordmark" to="/" aria-label="Seekite home">
                  <span aria-hidden="true" className="wordmark-mark">
                    S
                  </span>
                  <span>Seekite</span>
                </Link>
                <nav className="site-nav" aria-label="Primary navigation">
                  <Link to="/docs/$" params={{ _splat: "getting-started" }}>
                    Docs
                  </Link>
                  <Link to="/docs/$" params={{ _splat: "benchmarks" }}>
                    Benchmarks
                  </Link>
                  <Link to="/playground">Playground</Link>
                </nav>
                <div className="header-actions">
                  <SearchTrigger />
                  <a
                    className="icon-link"
                    href="https://github.com/spadenbargo/seekite"
                    aria-label="Seekite on GitHub"
                  >
                    <GitFork aria-hidden="true" />
                  </a>
                  <ThemeToggle />
                </div>
              </div>
            </header>
            {children}
            <footer className="site-footer">
              <div>
                <Link className="wordmark" to="/">
                  Seekite
                </Link>
                <p>Hybrid search that ships with your site.</p>
              </div>
              <nav aria-label="Footer navigation">
                <Link to="/docs/$" params={{ _splat: "getting-started" }}>
                  Docs
                </Link>
                <Link to="/docs/$" params={{ _splat: "benchmarks" }}>
                  Benchmarks
                </Link>
                <Link to="/playground">Playground</Link>
                <a href="https://github.com/spadenbargo/seekite">GitHub</a>
              </nav>
            </footer>
          </DocsSearchProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
