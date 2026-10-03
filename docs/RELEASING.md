# Releasing mdd-engine

## Automatic publication on main

[Build Flow](../.github/workflows/build.yml) enables package publication and GitHub Release creation for eligible pushes to `main`. It publishes `@wgtechlabs/mdd-engine` to both npm (`registry.npmjs.org`) and GitHub Packages (`npm.pkg.github.com`). This package does not publish a container image to GHCR.

The caller pins [Build Flow v0.3.3](https://github.com/wgtechlabs/build-flow-action/releases/tag/v0.3.3) at immutable commit `721e590fb0be0b8622839cd8226b39f8beac33dd`. The release-gate correction was reviewed in [PR #54](https://github.com/wgtechlabs/build-flow-action/pull/54) and promoted through [PR #55](https://github.com/wgtechlabs/build-flow-action/pull/55); both are merged and their required checks passed. The first version plan has been verified as `0.1.0` in the [main validation run](https://github.com/wgtechlabs/mdd-engine/actions/runs/37107277522); the release tag is `v0.1.0` and the npm dist-tag is `latest`.

PRs, pushes to `dev`, and manual runs validate changes without publishing artifacts. Promoting this configuration to `main` enables the release path. Use a regular merge commit for the `dev` → `main` promotion and obtain explicit merge/release authorization.

## Required sequence

1. CI runs the Bun checks and packed-package smoke check on Node 22, 24, and 26. Dependency auditing and Gitleaks must pass.
2. Enabled CodeQL analysis must succeed before source finalization or publication.
3. Build Flow finalizes the planned version, source commit, changelog, and tag once.
4. The package job checks out that exact finalized commit, builds the package, and publishes to both registries.
5. Both registry results must report success and the complete package job must succeed before Build Flow creates the GitHub Release.

The package primitive's `artifact-published` output means at least one registry published. Build Flow checks complete publication separately; the aggregate flag alone is insufficient. Failure of either registry, a later package step, or required security analysis must prevent the GitHub Release. Preserve these guarantees when upgrading the workflow pin.

## Toolchain and credentials

- `packageManager: bun@1.3.10` selects Bun for installation, development checks, builds, and publishing. Commit `bun.lock` and use frozen installs in CI.
- Node 24.21.0 is the pinned default LTS runtime. The compatibility matrix also covers Node 22 and 26; smoke checks execute the packed package in real Node processes without Bun.
- Explicit CI overrides propagate failures. The build check includes `bun audit` before publication; the primitive's own audit runs after publishing and is not a substitute for this gate.
- CodeQL uses `codeql-build-mode: none` for JavaScript/TypeScript source analysis.
- `NPM_TOKEN` is inherited from GitHub Actions secrets. It must have publish access for the npm scope. The organization secret is available to this repository, but secret metadata does not verify its registry permissions or expiry.
- GitHub Packages and GitHub Release creation use the built-in `GITHUB_TOKEN`. Preserve the caller's required permissions and allow the authorized release commit/tag on `main`.
- Retain the MIT `LICENSE` in the package and the repository metadata linking it to `wgtechlabs/mdd-engine`.

## Verify a release

After the main workflow completes, verify the actual version in both registries, package contents and integrity, GitHub package visibility, and the GitHub Release tag/commit. GitHub Packages may initially be private; confirm the intended public visibility. Successful validation or an accepted workflow run does not prove publication.

The packed package must contain runtime JavaScript, TypeScript declarations, README, and LICENSE, while excluding tests, credentials, caches, and development files. Before the first release or a compatibility change, verify current Node 22/24/26 and the lowest version claimed by `engines.node`.

## Recover partial publication

Registry publication is not atomic. If one registry succeeds and the other fails, the GitHub Release must remain unpublished. Do not delete the published version or blindly rerun the whole workflow: the primitive attempts both registries again and does not treat an existing version as a successful retry.

1. Record the finalized tag/commit, exact package version, successful registry, and failed job logs. Correct the failed registry's credentials or access issue.
2. Retrieve the published tarball from the successful registry and verify its identity, version, metadata, integrity, and contents against the finalized source. Preserve those package bytes for recovery.
3. With explicit publication authorization, publish that verified tarball only to the missing registry using its own credentials. Do not rebuild a different artifact or change the released version.
4. Verify the same version and package contents in both registries and all required checks on the finalized source. Only then create the GitHub Release for the existing verified tag with explicit release authorization.

This is a manual recovery procedure, not automatic retry support. No live partial-publication recovery has been exercised for mdd-engine.

## Normal delivery

Work on a short-lived branch from `dev`, squash its PR into `dev`, and promote `dev` to `main` through a regular merge commit with a meaningful `🚀 release:` title. See [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
