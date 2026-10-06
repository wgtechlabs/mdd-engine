# Releasing mdd-engine

## Automatic publication channels

[Build Flow](../.github/workflows/build-flow.yml) uses its default development, pull-request, and manual preview publication channels, plus regular package publication with a GitHub Release from `main`. It publishes `@wgtechlabs/mdd-engine` to both npm (`registry.npmjs.org`) and GitHub Packages (`npm.pkg.github.com`). This package does not publish a container image to GHCR.

The workflow pins released [Build Flow v1.0.0](https://github.com/wgtechlabs/build-flow-action/releases/tag/v1.0.0) at immutable commit [`f8263c388160a62f4a0e72ed888e56c8e9159469`](https://github.com/wgtechlabs/build-flow-action/commit/f8263c388160a62f4a0e72ed888e56c8e9159469). It uses the released [Package Build Flow v2.3.0](https://github.com/wgtechlabs/package-build-flow-action/releases/tag/v2.3.0). Workflow validation does not prove npm trust configuration or publication.

The caller enables the package flow and inherits the pinned defaults for publication, both registries, npm OIDC, and releases. It does not override `publish-dev-artifacts`, `publish-pr-artifacts`, `publish-manual-artifacts`, or `package-publish-enabled`; all default to `true`.

| Eligible trigger | Package version | Install tag | GitHub Release |
|---|---|---|---|
| Push to `dev` | `<base>-dev.<sha>` | `dev` | None |
| PR targeting `dev` | `<base>-pr.<sha>` | `pr` | None |
| PR from `dev` to `main` | `<base>-dev.<sha>` | `dev` | None |
| Other PR targeting `main` | `<base>-patch.<sha>` | `patch` | None |
| Manual run (`workflow_dispatch`) | `<base>-wip.<sha>` | `wip` | None |
| Push to `main` with a planned version bump | Planned regular version | `latest` | After both registries succeed |

`<base>` is the version in `package.json`; `<sha>` is the first seven characters of the workflow's commit SHA. PR runs build GitHub's test-merge commit, not just the source-branch head. For example, a PR targeting `dev` can publish `0.1.0-pr.abcdef1`.

After a successful publication, install a channel with `bun add @wgtechlabs/mdd-engine@dev` or `bun add @wgtechlabs/mdd-engine@pr`. Install an exact version to test a particular PR: the `pr` tag is shared across PRs, and `dev` is shared by dev pushes and promotion PRs. Each tag follows the most recently published package in its channel. Preview publication does not move `latest`. The package action's default PR comment provides installation instructions after successful publication.

Commit-type filtering is disabled by default, so setup or documentation changes can publish previews too. Default bot detection can suppress publication. Fork PRs cannot be assumed publishable: GitHub restricts write permissions and credentials on those runs. Keep those platform restrictions; do not use `pull_request_target` to run contributor code with publishing credentials.

The caller listens to pushes and PRs for `dev`/`main`, plus manual dispatch. Feature-branch pushes without an eligible PR do not run it. The standalone primitive's unplanned-main `staging` flow is not used here: the orchestrator plans and finalizes regular versions before main publication. Do not add a `release: published` trigger to republish a version already handled by the orchestrator.

Updating a PR can publish a preview immediately. Merging into `dev` can publish a development package. Use a regular merge commit for the `dev` → `main` promotion, which can publish a regular release. These operations must stay within the authorized delivery scope.

## Required sequence

1. CI runs the Bun checks and packed-package smoke check on Node 22, 24, and 26. Dependency auditing and Gitleaks must pass.
2. Enabled CodeQL analysis must succeed before source finalization or publication.
3. On `main`, Build Flow finalizes the planned version, source commit, changelog, and tag once. Preview builds skip release finalization and use the triggering commit.
4. The package job checks out that source commit, builds the package with the appropriate version/dist-tag, and publishes to both registries.
5. For `main`, both registry results must report success and the complete package job must succeed before Build Flow creates the GitHub Release. Preview builds do not create a GitHub Release.

The package primitive's `artifact-published` output means at least one registry published. Build Flow checks complete publication separately; the aggregate flag alone is insufficient. Failure of either registry, a later package step, or required security analysis must prevent the GitHub Release. Preserve these guarantees when upgrading the workflow pin.

## Toolchain and credentials

- `packageManager: bun@1.3.10` selects Bun for installation, development checks, builds, and packing. Commit `bun.lock` and use frozen installs in CI. In OIDC mode, the native npm CLI uploads the Bun-packed tarball to npm; Bun remains the project toolchain.
- Node 24.21.0 is the pinned default LTS runtime. The compatibility matrix also covers Node 22 and 26; smoke checks execute the packed package in real Node processes without Bun.
- The OIDC publishing job requires npm CLI 11.5.1 or newer and Node 22.14.0 or newer; use the pinned Node 24.21.0 runtime. These publishing-tool requirements do not change the package's consumer runtime range.
- Explicit CI overrides propagate failures. The build check includes `bun audit` before publication; the primitive's own audit runs after publishing and is not a substitute for this gate.
- CodeQL uses `codeql-build-mode: none` for JavaScript/TypeScript source analysis.
- The caller inherits `package-npm-auth-method: oidc`. npm publishing requires no `NPM_TOKEN` and must not fall back to a long-lived publish token.
- GitHub Packages uses its separate built-in `GITHUB_TOKEN` with `packages: write`; GitHub Release creation requires `contents: write`. npm OIDC does not replace these GitHub permissions. Preserve the caller's other required permissions and allow the authorized release commit/tag on `main`.
- Retain the MIT `LICENSE` in the package and the repository metadata linking it to `wgtechlabs/mdd-engine`.

## Configure automatic npm publishing

Once the package exists on npm, add a GitHub Actions trusted publisher in its npm settings:

| Field | Value |
|---|---|
| Organization or user | `wgtechlabs` |
| Repository | `mdd-engine` |
| Workflow filename | `build-flow.yml` |
| Environment | Leave empty unless the publishing job declares one |
| Allowed actions | Enable **npm publish** for direct automatic publication |

Trust the calling workflow in this repository, even though reusable Build Flow workflows perform the upload. Grant `id-token: write` through the caller and called workflows, use GitHub-hosted runners, and verify the inherited `package-npm-auth-method: oidc` default when upgrading Build Flow. Keep both registries enabled. See [npm's trusted-publishing guide](https://docs.npmjs.com/trusted-publishers/) for the platform requirements and settings.

After setup, eligible future releases publish automatically without an npm publish token or a per-version promotion step. Saving the trusted publisher does not verify it; confirm a successful OIDC publication before considering migration complete.

The trusted publisher identifies the caller `build-flow.yml` for all eligible channels; verify each publishing path against the registries rather than assuming a configured channel has succeeded. Create the configuration shortly before an authorized publication: it must complete its first successful publish within **48 hours of creation**. That successful publish validates the configuration and removes its expiry. If it expires before publication, recreate it to start a new 48-hour window; ordinary edits do not reset the deadline. Changing the repository or project identity requires a new trust relationship and validation window. See [npm's validation-window announcement](https://github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire/). The deadline does not replace the bootstrap, merge-authorization, or release-verification requirements below.

## Bootstrap the first npm version

If npm still returns 404 for `@wgtechlabs/mdd-engine`, bootstrap the package once before configuring its trusted publisher. Use the preserved, validated `0.1.0` tarball associated with `v0.1.0` and finalized main commit [`3975075b4dee44806012e71d80e858ddcf2b39a9`](https://github.com/wgtechlabs/mdd-engine/commit/3975075b4dee44806012e71d80e858ddcf2b39a9).

Recheck npm immediately before publishing. Verify the tarball's recorded integrity, package identity, version, contents, and finalized source; then an authorized maintainer can publish those exact bytes to npm with public access and the `latest` dist-tag, completing npm's interactive authentication/2FA requirements. Do not commit credentials, rebuild a substitute tarball, move the existing tag, or publish an already existing version.

Verify the npm result, configure the trusted publisher, and complete the missing-registry/release checks below. This one-time bootstrap does not establish that the later OIDC workflow works.

## Verify a release

After a publishing workflow completes, verify the actual version and dist-tag in both registries, package contents and integrity, and GitHub package visibility. For a regular release from `main`, also verify the GitHub Release tag/commit. Preview builds must update their expected channel tag without moving `latest`. For PRs, also verify the published version matches the test-merge commit and the installation comment is accurate. GitHub Packages may initially be private; confirm the intended public visibility. Successful validation or an accepted workflow run does not prove publication.

The packed package must contain runtime JavaScript, TypeScript declarations, README, and LICENSE, while excluding tests, credentials, caches, and development files. Before the first release or a compatibility change, verify current Node 22/24/26 and the lowest version claimed by `engines.node`.

## Recover partial publication

Registry publication is not atomic. If one registry succeeds and the other fails, the GitHub Release must remain unpublished. Do not delete the published version or blindly rerun the whole workflow: the primitive attempts both registries again and does not treat an existing version as a successful retry.

1. Record the source commit, finalized tag if applicable, exact package version/dist-tag, successful registry, and failed job logs. Correct the failed registry's access issue: npm trusted-publisher identity/OIDC permissions (recreate an expired configuration) or GitHub package permissions, as applicable.
2. Retrieve the published tarball from the successful registry and verify its identity, version, metadata, integrity, and contents against that source. Preserve those package bytes for recovery.
3. With explicit publication authorization, publish that verified tarball only to the missing registry using authentication accepted by that registry and the recorded dist-tag. For preview recovery, explicitly use the recorded `--tag dev`, `--tag pr`, `--tag patch`, or `--tag wip` so the upload cannot move `latest`. Do not rebuild a different artifact, change the released version, or rewrite the finalized tag.
4. Verify the same version, dist-tag, and package contents in both registries and all required checks on that source. For a regular release from `main`, only then create the GitHub Release for the existing verified tag with explicit release authorization. Preview package recovery does not create a GitHub Release.

This is a manual recovery procedure, not automatic retry support. No live partial-publication recovery has been exercised for mdd-engine.

## Normal delivery

Work on a short-lived branch from `dev`, use its eligible PR preview for testing, and squash the PR into `dev` for a development package build. Promote `dev` to `main` through a regular merge commit with a meaningful `🚀 release:` title for a regular release. See [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
