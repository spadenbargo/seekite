# Governance

Seekite is currently a single-maintainer project. Baden Spargo (`@spadenbargo`)
is the lead maintainer and final decision-maker (BDFL). Stating this directly is
more useful than implying a committee that does not yet exist.

## How decisions are made

Routine fixes and features are decided through issue and pull-request review.
Changes to the index format, public APIs, security model, package boundaries, or
governance should begin with a written proposal. The maintainer seeks rough
consensus, weighs user impact and evidence, and records the rationale when making
the final call. Decisions may be revisited when new data appears.

The maintainer is responsible for releases, security response, moderation,
repository access, and enforcing compatibility policy. Conflicts of interest
should be disclosed. Conduct matters are handled under the
[Code of Conduct](CODE_OF_CONDUCT.md), not by public vote.

## Becoming a maintainer

Additional maintainers are invited based on sustained, constructive work rather
than a fixed contribution count. Signals include sound reviews, dependable
follow-through, care for compatibility and users, responsible handling of
security-sensitive work, and alignment with the Code of Conduct.

Access grows gradually: issue triage, then review/merge responsibility for a
subsystem, then release or administration rights. Existing maintainers document
the scope when granting access. A maintainer may step down at any time; access
may be removed for prolonged inactivity, security reasons, or Code of Conduct
violations after a private conversation when circumstances allow.

If the lead maintainer becomes unavailable, active maintainers should preserve
the project, select an interim release owner, and document a succession decision
publicly. Until there is a second maintainer, release automation and written
process are the primary bus-factor mitigation.

## Triage and project health

The maintainer schedules a monthly triage pass for unanswered issues, pull
requests, security follow-ups, and the `good first issue` queue. Seekite does not
use an automated stale bot; inactivity alone is not a reason to close a valid
report. GitHub Discussions is the preferred place for Q&A and early ideas so the
issue tracker remains actionable.

This document will evolve as the maintainer group grows. Governance changes use
the same public proposal and review process as other project-wide decisions.
