import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Boxes, Cpu, PackageCheck } from "lucide-react";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { ArtifactStats } from "../components/artifact-stats";
import { InstallCommand } from "../components/install-command";
import { IntegrationGrid } from "../components/integration-grid";
import { LiveSearch } from "../components/site-search";
import { baseOptions } from "../lib/layout.shared";

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
    <HomeLayout {...baseOptions()}>
      <div id="main-content" className="landing-page">
        <section className="hero page-shell">
          <div className="hero-copy-block">
            <p className="eyebrow">Static hybrid search</p>
            <h1>Search your site.</h1>
            <p className="hero-copy">
              Build compact lexical and semantic indexes in CI. Query them privately in the browser.
              No hosted service, crawler, or API key.
            </p>
            <div className="hero-actions">
              <Link
                className={buttonVariants({ color: "primary" })}
                to="/docs/$"
                params={{ _splat: "getting-started" }}
              >
                Get started <ArrowRight aria-hidden="true" />
              </Link>
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
              <LiveSearch />
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
      </div>
    </HomeLayout>
  );
}
