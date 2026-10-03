# Bootstrap verification

Verified October 3, 2026 on the `feature/headless-engine` implementation. This records local and repository-configuration evidence; it does not claim a published package or production release.

| Check | Result |
|---|---|
| Frozen Bun installation | Passed with Bun 1.3.10 and committed `bun.lock` |
| Biome formatting/lint | Passed |
| TypeScript check and declaration build | Passed |
| Bun unit/integration tests | 75 passed, 0 failed; 241 assertions |
| Coverage | 96.74% lines, 94.38% functions |
| Dependency audit | No vulnerabilities reported by `bun audit` |
| Packed package consumer | Passed on Node 22.0.0, 22.16.0, 24.21.0, and 26.10.0 |
| Package contents | Runtime ESM, declarations, README, package metadata; no source tests, cache, or secrets |
| Runtime independence | Packed consumer ran with no Bun global and only its Node binary directory in PATH |
| Public-prefix fixtures | `/`, `/docs/`, `/repository/docs/` passed |
| Workflow static validation | Actionlint 1.7.12 passed; 20 caller inputs match pinned upstream schema |
| GHLT migration | 9 initial labels replaced with 23 Clean Labels; authoritative read-back passed |
| Clean Flow bootstrap | Remote `main` and `dev` established; work isolated on feature branch; rebase merging disabled |

The tests exercise config defaults and unknown/null settings, custom paths/themes, invalid JSON, required homepage, root overlap, traversal and symlinks, metadata, GFM/components, nested diagnostics, unsafe URLs, deterministic routes/navigation/headings, dotted routes, reference images, local targets/anchors, assets, reserved paths, and normalized Markdown.

Independent review confirmed and corrected dotted-route lookup and reference-image validation gaps, and aligned reserved names with the planned website exporter. Review also checked the publication locks; all changes were followed by affected tests and runtime checks.

## Boundaries

- The package is not published. npm returned no public package for `@wgtechlabs/mdd-engine`; publish access still needs verification.
- The repository license remains unchosen and the package is marked `UNLICENSED` until the owner selects one.
- Actual publishing and GitHub Release creation are locked because the pinned upstream workflow does not enforce successful publication to both registries. See [RELEASING.md](RELEASING.md).
- GitHub-hosted CI results must be read from the feature pull request. Static workflow validation and local checks do not prove provider execution.
- No website, Railway deployment, or other mdd repository was implemented in this phase.
