# Releasing mdd-engine

## Automatic publication on main

[Build Flow](../.github/workflows/build.yml) enables package publication and GitHub Release creation for eligible pushes to `main`. It publishes `@wgtechlabs/mdd-engine` to both npm (`registry.npmjs.org`) and GitHub Packages (`npm.pkg.github.com`). This package does not publish a container image to GHCR.

This migration currently pins the reviewed [Build Flow OIDC integration commit](https://github.com/wgtechlabs/build-flow-action/commit/167779d858c63426c534bce28e2d10aba1787e58) for validation. It uses the released [Package Build Flow v2.3.0](https://github.com/wgtechlabs/package-build-flow-action/releases/tag/v2.3.0). **Replace the integration pin with its released Build Flow commit before merging this migration.** Workflow validation does not prove npm trust configuration or publication.

PRs, pushes to `dev`, and manual runs validate changes without publishing artifacts. Promoting this configuration to `main` enables the release path. Use a regular merge commit for the `dev` → `main` promotion and obtain explicit merge/release authorization.

## Required sequence

1. CI runs the Bun checks and packed-package smoke check on Node 22, 24, and 26. Dependency auditing and Gitleaks must pass.
2. Enabled CodeQL analysis must succeed before source finalization or publication.
3. Build Flow finalizes the planned version, source commit, changelog, and tag once.
4. The package job checks out that exact finalized commit, builds the package, and publishes to both registries.
5. Both registry results must report success and the complete package job must succeed before Build Flow creates the GitHub Release.

The package primitive's `artifact-published` output means at least one registry published. Build Flow checks complete publication separately; the aggregate flag alone is insufficient. Failure of either registry, a later package step, or required security analysis must prevent the GitHub Release. Preserve these guarantees when upgrading the workflow pin.

## Toolchain and credentials

- `packageManager: bun@1.3.10` selects Bun for installation, development checks, builds, and packing. Commit `bun.lock` and use frozen installs in CI. In OIDC mode, the native npm CLI uploads the Bun-packed tarball to npm; Bun remains the project toolchain.
- Node 24.21.0 is the pinned default LTS runtime. The compatibility matrix also covers Node 22 and 26; smoke checks execute the packed package in real Node processes without Bun.
- The OIDC publishing job requires npm CLI 11.5.1 or newer and Node 22.14.0 or newer; use the pinned Node 24.21.0 runtime. These publishing-tool requirements do not change the package's consumer runtime range.
- Explicit CI overrides propagate failures. The build check includes `bun audit` before publication; the primitive's own audit runs after publishing and is not a substitute for this gate.
- CodeQL uses `codeql-build-mode: none` for JavaScript/TypeScript source analysis.
- The caller selects `package-npm-auth-method: oidc`. npm publishing requires no `NPM_TOKEN` and must not fall back to a long-lived publish token.
- GitHub Packages uses its separate built-in `GITHUB_TOKEN` with `packages: write`; GitHub Release creation requires `contents: write`. npm OIDC does not replace these GitHub permissions. Preserve the caller's other required permissions and allow the authorized release commit/tag on `main`.
- Retain the MIT `LICENSE` in the package and the repository metadata linking it to `wgtechlabs/mdd-engine`.

## Configure automatic npm publishing

Once the package exists on npm, add a GitHub Actions trusted publisher in its npm settings:

| Field | Value |
|---|---|
| Organization or user | `wgtechlabs` |
| Repository | `mdd-engine` |
| Workflow filename | `build.yml` |
| Environment | Leave empty unless the publishing job declares one |
| Allowed actions | Enable **npm publish** for direct automatic publication |

Trust the calling workflow in this repository, even though reusable Build Flow workflows perform the upload. Grant `id-token: write` through the caller and called workflows, use GitHub-hosted runners, and retain `package-npm-auth-method: oidc` when adopting the released Build Flow integration. Keep both registries enabled. See [npm's trusted-publishing guide](https://docs.npmjs.com/trusted-publishers/) for the platform requirements and settings.

After setup, eligible future releases publish automatically without an npm publish token or a per-version promotion step. Saving the trusted publisher does not verify it; confirm a successful OIDC publication before considering migration complete.

## Bootstrap the first npm version

If npm still returns 404 for `@wgtechlabs/mdd-engine`, bootstrap the package once before configuring its trusted publisher. Use the preserved, validated `0.1.0` tarball associated with `v0.1.0` and finalized main commit [`3975075b4dee44806012e71d80e858ddcf2b39a9`](https://github.com/wgtechlabs/mdd-engine/commit/3975075b4dee44806012e71d80e858ddcf2b39a9).

Recheck npm immediately before publishing. Verify the tarball's recorded integrity, package identity, version, contents, and finalized source; then an authorized maintainer can publish those exact bytes to npm with public access and the `latest` dist-tag, completing npm's interactive authentication/2FA requirements. Do not commit credentials, rebuild a substitute tarball, move the existing tag, or publish an already existing version.

Verify the npm result, configure the trusted publisher, and complete the missing-registry/release checks below. This one-time bootstrap does not establish that the later OIDC workflow works.

## Verify a release

After the main workflow completes, verify the actual version in both registries, package contents and integrity, GitHub package visibility, and the GitHub Release tag/commit. GitHub Packages may initially be private; confirm the intended public visibility. Successful validation or an accepted workflow run does not prove publication.

The packed package must contain runtime JavaScript, TypeScript declarations, README, and LICENSE, while excluding tests, credentials, caches, and development files. Before the first release or a compatibility change, verify current Node 22/24/26 and the lowest version claimed by `engines.node`.

## Recover partial publication

Registry publication is not atomic. If one registry succeeds and the other fails, the GitHub Release must remain unpublished. Do not delete the published version or blindly rerun the whole workflow: the primitive attempts both registries again and does not treat an existing version as a successful retry.

1. Record the finalized tag/commit, exact package version, successful registry, and failed job logs. Correct the failed registry's access issue: npm trusted-publisher identity/OIDC permissions or GitHub package permissions, as applicable.
2. Retrieve the published tarball from the successful registry and verify its identity, version, metadata, integrity, and contents against the finalized source. Preserve those package bytes for recovery.
3. With explicit publication authorization, publish that verified tarball only to the missing registry using authentication accepted by that registry. Do not rebuild a different artifact, change the released version, or rewrite the finalized tag.
4. Verify the same version and package contents in both registries and all required checks on the finalized source. Only then create the GitHub Release for the existing verified tag with explicit release authorization.

This is a manual recovery procedure, not automatic retry support. No live partial-publication recovery has been exercised for mdd-engine.

## Normal delivery

Work on a short-lived branch from `dev`, squash its PR into `dev`, and promote `dev` to `main` through a regular merge commit with a meaningful `🚀 release:` title. See [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
