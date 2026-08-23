import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import githubDarkIcon from "../assets/brand/github-dark.svg";
import githubLightIcon from "../assets/brand/github-light.svg";
import { CompactSearchTrigger, FullSearchTrigger } from "../components/site-search";

export const repositoryUrl = "https://github.com/spadenbargo/seekite";

function GitHubBrandIcon() {
  return (
    <span className="github-brand-icon" aria-hidden="true">
      <img src={githubLightIcon} alt="" data-icon-theme="light" />
      <img src={githubDarkIcon} alt="" data-icon-theme="dark" />
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="brand-title">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Seekite</span>
        </span>
      ),
      transparentMode: "top",
      url: "/",
    },
    links: [
      {
        text: "Docs",
        url: "/docs/getting-started",
      },
      {
        text: "Benchmarks",
        url: "/docs/benchmarks",
      },
      {
        text: "Playground",
        url: "/playground",
      },
      {
        type: "icon",
        label: "Seekite on GitHub",
        text: "GitHub",
        url: repositoryUrl,
        external: true,
        icon: <GitHubBrandIcon />,
      },
    ],
    slots: {
      searchTrigger: {
        sm: CompactSearchTrigger,
        full: FullSearchTrigger,
      },
    },
    themeSwitch: {
      mode: "light-dark",
    },
  };
}
