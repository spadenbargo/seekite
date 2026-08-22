import path from "node:path";

export default function fixturePages(context) {
  return {
    name: "fixture-pages",
    async contentLoaded({ actions }) {
      actions.addRoute({
        path: "/",
        exact: true,
        component: path.join(context.siteDir, "src/pages/index.jsx"),
      });
      actions.addRoute({
        path: "/guide",
        exact: true,
        component: path.join(context.siteDir, "src/pages/guide.jsx"),
      });
    },
  };
}
