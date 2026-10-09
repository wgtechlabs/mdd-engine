# Bootstrap verification

Verified October 3, 2026 on the `feature/headless-engine` implementation. This records local and repository-configuration evidence; it does not claim a published package or production release.

| Check | Result |
|---|---|
| Frozen Bun installation | Passed with Bun 1.3.10 and committed `bun.lock` |
| Biome formatting/lint | Passed |
| TypeScript check and declaration build | Passed |
| Bun unit/integration tests | 80 passed, 0 failed; 258 assertions |
| Coverage | 96.89% lines, 94.38% functions |
| Dependency audit | No vulnerabilities reported by `bun audit` |
| Packed package consumer | Passed on Node 22.0.0, 22.16.0, 24.21.0, and 26.10.0 |
| Package contents | Runtime ESM, declarations, README, package metadata; no source tests, cache, or secrets |
| Runtime independence | Packed consumer ran with no Bun global and only its Node binary directory in PATH |
| Public-prefix fixtures | `/`, `/docs/`, `/repository/docs/` passed |
| Workflow static validation | Actionlint 1.7.12 passed; 21 caller inputs match pinned upstream schema |
| CodeQL configuration | Uses `none` for JavaScript/TypeScript source analysis; skips Bun setup/install/build in the separate scan job |
| GHLT migration | 9 initial labels replaced with 23 Clean Labels; authoritative read-back passed |
| Clean Flow bootstrap | Remote `main` and `dev` established; work isolated on feature branch; rebase merging disabled |

The tests exercise config defaults and unknown/null settings, custom paths/themes, invalid JSON, required homepage, root overlap, traversal and symlinks, metadata, GFM/components, nested diagnostics, unsafe URLs, deterministic routes/navigation/headings, dotted routes, reference images, local targets/anchors, assets, reserved paths, and normalized Markdown.

Independent review confirmed and corrected dotted-route lookup and reference-image validation gaps, aligned reserved names with the planned website exporter, and corrected existing-asset precedence over dotted page routes. Review also checked the publication locks; all changes were followed by affected tests and runtime checks.

## PR #2 reference-definition fixes

Verified October 3, 2026 after the promotion review. Nine additional compilation regressions cover unused and duplicate link/image definitions, inactive footnote headings and links, referenced and transitive footnotes, and global definitions nested inside omitted footnotes. Five of the new cases failed against the original implementation and passed after the correction.

- `bun run check`: lint, type checking, all 89 tests (288 assertions), build, and packed consumer passed.
- `bun run coverage`: 96.92% lines and 94.38% functions.
- The same packed package passed on Node 22.0.0, 22.16.0, 24.21.0, and 26.10.0.
- `bun audit`: no vulnerabilities reported.
- Independent review found no actionable issues in the fix; ten additional probes covered cycles, duplicate footnotes, render/heading order, active security validation, and globally scoped definitions under omitted footnotes.

## Boundaries

- The package is not published. npm returned no public package for `@wgtechlabs/mdd-engine`; publish access still needs verification.
- The owner selected the MIT License on October 3, 2026. The repository includes `LICENSE`, and package metadata declares `MIT`.
- Publishing and GitHub Release creation are enabled for eligible pushes to `main`, using the corrected upstream security and dual-registry gates. Configuration and simulated failure checks do not prove a live registry publication. See [RELEASING.md](RELEASING.md).
- GitHub-hosted CI results must be read from the feature pull request. Static workflow validation and local checks do not prove provider execution.
- No website, Railway deployment, or other mdd repository was implemented in this phase.

## October 10 section search

The opt-in section search API adds coherent page/heading results, display
breadcrumbs, bounded single-term typo correction, and UTF-16 ranges for original
text highlighting. Default page search retains its existing matching/ranking.
The new regression suite failed before implementation and now passes.

Local validation: `bun run check` passed lint, types, 221 tests / 1014 assertions,
build, and packed Node 22.16.0 consumer checks. The same archive additionally
passed under Node 22.0.0, 24.21.0, and 26.10.0. Tests cover distinct and duplicate
heading destinations, all public prefixes, coherent multiword results, typo
bounds/ranking, Unicode graphemes, text-only output, validation, JSON round trips,
and legacy behavior. `bun audit` reported no known vulnerabilities.

A local timing probe over 500 pages / 1,500 sections with 989-character bodies
measured warm median queries of about 14 ms for section lookup and 43 ms for typo
fallback under Bun 1.3.10. This is a diagnostic sample, not a portable performance
guarantee. Original-text mapping happens only after limiting the returned hits.

Remote CI, independent PR review, merges, and publication are verified separately
on the delivery PRs; the local results alone do not establish those outcomes.
