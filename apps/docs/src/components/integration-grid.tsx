import { ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";

const integrations = [
  { name: "Vite", slug: "vite", icon: "https://svgl.app/library/vite.svg" },
  { name: "Astro", slug: "astro", icon: "https://svgl.app/library/astro-icon-light.svg" },
  { name: "Next.js", slug: "next", icon: "https://svgl.app/library/nextjs_icon_dark.svg" },
  { name: "Docusaurus", slug: "docusaurus", icon: "https://svgl.app/library/docusaurus.svg" },
] as const;

export function IntegrationGrid() {
  return (
    <div className="integration-grid">
      {integrations.map((integration) => (
        <Link
          key={integration.slug}
          to="/docs/$"
          params={{ _splat: `integrations/${integration.slug}` }}
        >
          <span className="integration-icon">
            <img src={integration.icon} alt="" loading="lazy" />
          </span>
          <span>{integration.name}</span>
          <ArrowUpRight aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
