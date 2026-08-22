# Contributing to Seekite

Thank you for helping make Seekite better. Contributions of code, tests,
documentation, benchmark data, and well-scoped bug reports are all welcome.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
For vulnerabilities, use the private process in [SECURITY.md](SECURITY.md)
instead of opening a public issue.

## Development setup

Seekite requires Node.js 20 or newer and uses the pnpm version declared in the
root `package.json`.

```sh
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm test
```

Vite+ is a normal workspace development dependency, so the `pnpm` scripts work
without a global installation. Installing the `vp` CLI is optional and gives
shorter commands:

```sh
curl -fsSL https://vite.plus | bash
vp test run
vp check
```

The equivalent repository-local commands are:

```sh
pnpm test
pnpm check
pnpm build
pnpm run ci
```

Run a targeted package command while iterating, then run the relevant root
gates before submitting a pull request:

```sh
pnpm --filter @seekite/core typecheck
pnpm exec vp test run packages/core/src/core.test.ts
```

### Optional Rust and WebAssembly toolchains

TypeScript-only contributors do **not** need Rust, Cargo, a C compiler, or
`wasm-pack`. Generated WebAssembly and JavaScript bindings are checked in, and
unsupported native platforms fall back to WebAssembly.

You need the stable Rust toolchain and a platform C/C++ toolchain only when
changing `packages/embeddings-ternlight/native` or
`packages/engine-native/crates`. Regenerating WebAssembly also requires
`wasm-pack`. Follow the package READMEs and run the native parity suite; native
and WebAssembly providers must remain bit-identical.

## Choosing an issue

Issues labeled `good first issue` are intentionally narrow and should include
context, acceptance criteria, and likely test locations. The maintainer reviews
this queue during monthly triage and keeps it stocked as suitable work is
identified. Comment before starting so parallel contributors do not duplicate
effort. Issues labeled `help wanted` may require more repository familiarity.

For design proposals or questions that are not yet actionable, start a GitHub
Discussion. Issues should describe work that can be reproduced or completed.

## Making a change

1. Create a focused branch from `main`.
2. Add or update tests with the implementation. Do not weaken an existing test
   to make a change pass.
3. Update public documentation for user-visible behavior.
4. Run targeted tests, then `pnpm check`, `pnpm test`, and `pnpm build` as
   appropriate for the affected packages.
5. Add a changeset for user-visible changes.

Search ranking, tokenization, chunking, quantization, or embedding changes must
include a quality delta against the accepted baseline. Run
`pnpm exec seekite bench --baseline <previous-run.json>` and attach the run file
or summarized Recall/MRR/NDCG delta to the pull request. Explain regressions,
even when they remain within the configured tolerance.

## Changesets

Every user-visible change needs a file in `.changeset/`:

```sh
pnpm dlx @changesets/cli@3.0.0 add
```

Choose the affected published packages and the smallest accurate SemVer bump.
Before 1.0, breaking changes use a minor bump; fixes use a patch bump. The core
protocol packages (`@seekite/core`, `@seekite/build`, `seekite`, and
`@seekite/vite`) are fixed-versioned and release together.

Changes affecting `search.config.ts`, the index format, or the query API must
include migration instructions in the changeset body. Tests, internal cleanup,
and documentation-only changes may omit a release changeset; explain why in the
pull-request checklist or add an empty changeset when the release bot requires
an explicit acknowledgement.

## Pull requests

Keep pull requests small enough to review. The description should cover the
problem, the chosen approach, tests run, compatibility impact, and any follow-up
work. Maintainers may ask to split unrelated changes.

All contributions are reviewed for correctness, accessibility, security,
performance, and compatibility. Review is a technical conversation; address
feedback with code or evidence, and ask when the intent is unclear.
