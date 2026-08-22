# Security policy

## Supported versions

Seekite is pre-1.0. Security fixes are released for the latest minor line only.

| Version | Supported |
| --- | --- |
| Latest `0.x` minor | Yes |
| Older `0.x` minors | No |
| Unreleased development branches | Best effort |

Upgrade to the newest release before reporting a problem that may already have
been fixed.

## Reporting a vulnerability

Please report vulnerabilities privately through this repository's **Security →
Advisories → Report a vulnerability** flow. Do not open a public issue, pull
request, or Discussion with exploit details.

If private vulnerability reporting is unavailable, email the maintainer at
`baden.spargo@gmail.com` with the subject `Seekite security report`. Encrypt
sensitive attachments when practical and do not include production secrets or
personal data in a proof of concept.

Include:

- the affected package and version or commit;
- impact and realistic attack scenario;
- reproduction steps or a minimal proof of concept;
- any known mitigations; and
- whether you plan to coordinate public disclosure.

The maintainer will acknowledge a report within three business days, provide a
status update after initial triage, and coordinate fixes and release timing with
the reporter. We target disclosure within 90 days. A shorter window may be used
when exploitation is active; a longer embargo requires agreement with the
reporter and a concrete reason. Credit is offered unless anonymity is requested.

## Scope and threat model

Seekite produces static index assets and runs search in browsers. Particularly
important vulnerability classes include:

- cross-site scripting or unsafe HTML in highlighting, snippets, hydrated
  content, and search UI rendering;
- path traversal or unintended file disclosure in Vite development-server
  middleware and build output handling;
- malformed index data causing denial of service, unsafe allocation, or trust
  boundary confusion; and
- native binding or model parsing flaws that can corrupt memory or escape the
  documented filesystem scope.

Reports about these boundaries are welcome even when exploitability is
uncertain. Security-sensitive rendering and path handling should have dedicated
regression tests with every fix.

Vulnerabilities in third-party dependencies are in scope when they are
reachable through supported Seekite behavior. Reports consisting only of an
automated dependency scan, without a reachable impact, may be closed after
triage. Social engineering, denial-of-service testing against infrastructure,
and access to data you do not own are out of scope.
