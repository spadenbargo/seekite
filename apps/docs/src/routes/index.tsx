import { Link, createFileRoute } from "@tanstack/react-router";
import { SearchBox } from "@seekite/react";
import { ArrowRight, Boxes, Cpu, PackageCheck } from "lucide-react";
import { ArtifactStats } from "../components/artifact-stats";
import { InstallCommand } from "../components/install-command";
import { IntegrationGrid } from "../components/integration-grid";
import { Button } from "../components/ui/button";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const steps = [
  {
    icon: Boxes,
    title: "Index at build time",
    body: "Turn your content into immutable lexical and vector artifacts.",
  },
  {
    icon: PackageCheck,
    title: "Deploy normal files",
    body: "Ship the index beside your site on any static host or CDN.",
  },
  {
    icon: Cpu,
    title: "Query in the browser",
    body: "Run lexical, semantic, or hybrid ranking in a lazy Web Worker.",
  },
];

function HomePage() {
  return (
    <main id="main-content">
      <section className="hero page-shell">
        <div className="hero-copy-block">
          <p className="eyebrow">Static hybrid search</p>
          <h1>
            Search your site.
            <span>Not your users.</span>
          </h1>
          <p className="hero-copy">
            Build compact lexical and semantic indexes in CI. Query them privately in the browser.
            No hosted service, crawler, or API key.
          </p>
          <div className="hero-actions">
            <Button asChild size="default">
              <Link to="/docs/$" params={{ _splat: "getting-started" }}>
                Get started <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <InstallCommand />
          </div>
        </div>
        <div className="search-demo">
          <div className="demo-bar">
            <span>Live index</span>
            <span className="status">
              <i /> browser only
            </span>
          </div>
          <div className="demo-body">
            <p>Search these docs</p>
            <SearchBox
              label="Live documentation search"
              placeholder="Try “typo tolarance”…"
              showFacets
              onResultSelect={(result) => window.location.assign(result.url)}
            />
          </div>
        </div>
      </section>

      <section className="fact-strip page-shell" aria-label="This documentation index">
        <ArtifactStats />
      </section>

      <section className="section page-shell" aria-labelledby="pipeline-title">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2 id="pipeline-title">Three small moving parts.</h2>
        </div>
        <div className="step-grid">
          {steps.map((step) => (
            <article key={step.title}>
              <step.icon aria-hidden="true" />
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section integrations page-shell" aria-labelledby="integrations-title">
        <div className="section-heading">
          <p className="eyebrow">Integrations</p>
          <h2 id="integrations-title">Bring your own site.</h2>
          <p>First-party guides for common build pipelines.</p>
        </div>
        <IntegrationGrid />
      </section>
    </main>
  );
}
