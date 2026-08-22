# Changesets

Every user-facing pull request must include a changeset. Create one from the
repository root:

```sh
pnpm changeset add
```

Select each affected published package and describe the observable change in
language suitable for a changelog. If a pull request deliberately has no
release impact, add an empty changeset with
`pnpm changeset add --empty` so reviewers can see that the
decision was intentional.

`@seekite/core`, `@seekite/build`, `seekite`, and `@seekite/vite` form a fixed
version group because they share the index-format protocol. A bump to one bumps
all four. Other packages version independently.

Before 1.0, a breaking change is a **minor** bump. Its changeset body must
contain practical migration steps. Migration notes are also required for any
change to `search.config.ts`, the query API, or index-format compatibility,
even when the change is not otherwise breaking.

Once release automation is activated, the release workflow maintains a
**Version Packages** pull request from `main`. Merging that pull request runs
the complete validation/build pipeline and then publishes with npm trusted
publishing and provenance. Until npm trusted publishing is configured, the
workflow is manual-only and requires an explicit confirmation input. Do not
publish from a developer machine or add a long-lived npm token to repository
secrets.

Before the first public release, and after changing release automation, run the
CI workflow manually with **release_dry_run** enabled. It snapshots the current
plan, publishes platform packages before the prepared native root into an
ephemeral Verdaccio registry, and installs/bundles the result from that registry.
