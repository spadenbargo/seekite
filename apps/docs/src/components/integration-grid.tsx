import { ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import astroDarkIcon from "../assets/brand/astro-dark.svg";
import astroLightIcon from "../assets/brand/astro-light.svg";
import docusaurusIcon from "../assets/brand/docusaurus.svg";
import nextjsIcon from "../assets/brand/nextjs.svg";
import viteIcon from "../assets/brand/vite.svg";

type BrandIcon = { src: string } | { dark: string; light: string };

const integrations = [
  { name: "Vite", slug: "vite", icon: { src: viteIcon } },
  {
    name: "Astro",
    slug: "astro",
    icon: { light: astroLightIcon, dark: astroDarkIcon },
  },
  { name: "Next.js", slug: "next", icon: { src: nextjsIcon } },
  { name: "Docusaurus", slug: "docusaurus", icon: { src: docusaurusIcon } },
] as const satisfies readonly { icon: BrandIcon; name: string; slug: string }[];

function IntegrationIcon({ icon, name }: { icon: BrandIcon; name: string }) {
  if ("src" in icon) {
    return (
      <span className="integration-icon" data-brand-icon={name}>
        <img src={icon.src} alt="" loading="lazy" />
      </span>
    );
  }

  return (
    <span className="integration-icon" data-brand-icon={name} data-has-theme-pair="">
      <img src={icon.light} alt="" loading="lazy" data-icon-theme="light" />
      <img src={icon.dark} alt="" loading="lazy" data-icon-theme="dark" />
    </span>
  );
}

export function IntegrationGrid() {
  return (
    <div className="integration-grid">
      {integrations.map((integration) => (
        <Link
          key={integration.slug}
          to="/docs/$"
          params={{ _splat: `integrations/${integration.slug}` }}
        >
          <IntegrationIcon icon={integration.icon} name={integration.name} />
          <span>{integration.name}</span>
          <ArrowUpRight aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
