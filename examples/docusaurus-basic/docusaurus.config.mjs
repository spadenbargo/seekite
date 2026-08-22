import seekite from "@seekite/docusaurus";

export default {
  title: "Seekite Docusaurus fixture",
  url: "https://example.test",
  baseUrl: "/handbook/",
  onBrokenLinks: "throw",
  plugins: [
    "./plugins/pages.mjs",
    [seekite, { config: { corpora: { docs: { exclude: ["/404"] } } } }],
  ],
};
