import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex" }],
  }),
  component: StaticShell,
});

function StaticShell() {
  return (
    <main id="main-content" className="not-found" data-seekite-ignore>
      <p>Loading the requested Seekite page…</p>
    </main>
  );
}
