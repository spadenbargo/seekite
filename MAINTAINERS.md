# Maintainer operations

This runbook covers production access, npm releases, and documentation
deployments. Public contributor instructions remain in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Access model

- Use individual accounts protected by passkeys or hardware-backed two-factor
  authentication. Never share GitHub, npm, or Cloudflare accounts.
- Grant the smallest role needed and review maintainers, GitHub Apps, npm
  package access, Cloudflare members, and recovery methods every quarter.
- Keep production changes attributable: merge through pull requests, let CI
  publish packages, and let Cloudflare build the exact Git commit it deploys.
- Do not put credentials in the repository, issue trackers, pull requests,
  build logs, package tarballs, or local `.env` files that may be committed.
  GitHub secret scanning and push protection are a backstop, not a vault.

The project currently has one maintainer, so `main` requires a pull request and
passing checks but not a second approval. Add a required CODEOWNER approval as
soon as a second release-capable maintainer exists.

Repository Actions permissions are read-only by default. GitHub's combined
**Allow GitHub Actions to create and approve pull requests** switch is enabled
only so the narrowly scoped Changesets version job can open its release pull
request. Project workflows must never approve or merge their own pull requests.

## npm release flow

Seekite uses Changesets in `alpha` prerelease mode. A contributor adds a
changeset to a pull request. After it merges, `release.yml` opens or updates the
version pull request. Merging that pull request runs the native parity matrix,
verifies the exact tarballs, publishes the native platform packages first, and
then publishes the remaining packages with npm provenance.

The `npm` GitHub environment is restricted to `main`. It intentionally contains
no `NPM_TOKEN`: npm trusts the GitHub OIDC identity for `spadenbargo/seekite`,
`release.yml`, and the `npm` environment. Every published package must have the
same trusted-publisher configuration.

The first publication is the only bootstrap exception because npm cannot add a
trusted publisher until a package exists. Publish the verified initial
tarballs from an interactive npm session with 2FA; do not create an automation
token. Immediately afterwards, configure all packages with npm CLI 11.15 or
newer:

```sh
for package in $(node scripts/public-package-names.mjs); do
  npm trust github "$package" \
    --repo spadenbargo/seekite \
    --file release.yml \
    --environment npm \
    --allow-publish \
    --yes
  sleep 2
done
```

Then set each package's publishing access on npm to **require 2FA and disallow
tokens**, verify an OIDC release, and enable the repository variable
`NPM_RELEASES_ENABLED=true`. Audit the trusted-publisher mapping after workflow
renames, repository transfers, and maintainer changes.

If OIDC is unavailable during an urgent security release, prefer an interactive
2FA publish from already-verified tarballs. A granular bypass-2FA token is a
last-resort break-glass credential: restrict it to the affected packages, give
it the shortest possible expiry, store it only in the protected `npm`
environment, and revoke it and delete the environment secret immediately after
the incident.

## Documentation deployment

The docs are a static Cloudflare Worker named `seekite-docs`, configured by
`apps/docs/wrangler.jsonc`. GitHub Actions builds, tests, and uploads the static
artifact without production credentials. Cloudflare Workers Builds owns the
deployment pipeline through its GitHub App:

| Setting | Value |
| --- | --- |
| Repository | `spadenbargo/seekite` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `pnpm docs:build` |
| Deploy command | `pnpm --filter @seekite/docs run deploy` |
| Non-production deploy command | `pnpm --filter @seekite/docs run deploy:preview` |

Limit the Cloudflare Workers & Pages GitHub App to this repository only. Workers
Builds manages its deployment token inside Cloudflare, so GitHub must not have
`CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` secrets. Non-secret settings
belong in versioned Wrangler configuration or ordinary environment variables;
runtime secrets, if the static site ever needs them, belong in encrypted
Cloudflare bindings and must never be exposed to browser code.

Before promoting an access change, confirm that an existing owner retains a
tested recovery path. When removing a maintainer, revoke GitHub, npm, and
Cloudflare access in the same maintenance window and audit recent releases and
deployments.
