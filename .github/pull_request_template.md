## Summary

<!-- What changes, and what user or maintainer problem does it solve? -->

## Validation

<!-- List the focused commands you ran and their results. -->

- [ ] Tests cover the changed behavior.
- [ ] `pnpm check`, `pnpm test`, and `pnpm build` pass, or failures are explained below.
- [ ] Documentation and examples reflect user-facing behavior.
- [ ] I inspected generated/packed output when package contents or exports changed.

## Release impact

- [ ] I added a changeset for every user-facing package change, or explained why this pull request has no release impact.
- [ ] Breaking pre-1.0 behavior uses a minor changeset and has migration notes.
- [ ] Changes to `search.config.ts`, the query API, or index-format compatibility include migration notes.

## Search-quality impact

<!-- Ranking changes must include `seekite bench --baseline <previous-run.json>` output. Remove this section when it is not applicable. -->

| Metric                      | Baseline | This change | Delta |
| --------------------------- | -------: | ----------: | ----: |
| NDCG / other primary metric |      n/a |         n/a |   n/a |

## Checklist

- [ ] The change is focused and does not include unrelated formatting or refactors.
- [ ] New dependencies, generated artifacts, and security-sensitive behavior are justified.
- [ ] I have not included secrets, private corpus content, or credentials.
