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
  publish packages, and deploy only the exact CI-verified artifact to Cloudflare.
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
`apps/docs/wrangler.jsonc`. The Docs CI workflow builds, unit-tests, and
browser-tests the site once, then deploys that exact uploaded artifact. A push
to `main` deploys production; same-repository pull requests receive a
`workers.dev` version preview. Fork pull requests build and test normally but
never receive Cloudflare credentials or attempt a deployment.

Create a `cloudflare-production` GitHub environment restricted to `main` and
store these environment secrets in it:

- `CLOUDFLARE_API_TOKEN`: an account-scoped token with only **Workers Scripts:
  Edit** for the account that owns `seekite-docs`.
- `CLOUDFLARE_ACCOUNT_ID`: the owning Cloudflare account identifier.

Store the same two values as repository Actions secrets for same-repository PR
previews. Do not expose them to fork workflows. Review the token's audit log and
rotate it at least every 90 days, immediately after maintainer removal, and
after any suspected disclosure. During rotation, replace the repository and
environment copies together, exercise a preview upload, then exercise a
production deployment before revoking the old token.

Wrangler retains previous Worker versions. To inspect and roll production back
from a trusted maintainer checkout, authenticate with the same least-privilege
credentials and run:

```sh
pnpm --filter @seekite/docs exec wrangler versions list
pnpm --filter @seekite/docs exec wrangler versions deploy <VERSION_ID>@100% --yes
```

For a gradual rollback, deploy the previous and current IDs with explicit
percentages first, verify production, and then move the previous ID to 100%.
Non-secret settings belong in versioned Wrangler configuration; future runtime
secrets belong in encrypted Cloudflare bindings and must never be exposed to
browser code.

## Benchmark operations

`Search benchmarks` runs the pinned SciFact, NFCorpus, and ArguAna lexical
suite every Monday and on manual dispatch. Dataset archives and extracted
corpora live only in the Actions cache or local `.cache/beir`; result JSON and
Markdown are retained as workflow artifacts for 90 days. Review measurements
from a designated machine before copying numbers into
`bench/beir/accepted.json` or the public benchmark page. Never commit dataset
contents.

Adding the `run-benchmarks` label to a pull request runs the cheaper docs-corpus
comparison against `bench/baseline.json`. A separate `workflow_run` job reads
the resulting artifact and updates the sticky PR comment; this keeps the
write-capable token out of the job that executes pull-request code, including
fork code. Remove and re-add the label to request another run without a code
change.

Before promoting an access change, confirm that an existing owner retains a
tested recovery path. When removing a maintainer, revoke GitHub, npm, and
Cloudflare access in the same maintenance window and audit recent releases and
deployments.
