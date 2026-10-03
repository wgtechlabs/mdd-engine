# mdd-engine agent instructions

## Scope and source of truth

This repository is `wgtechlabs/mdd-engine`, the independently usable headless Markdown documentation engine. Read [docs/SPEC.md](docs/SPEC.md) before changing its contract.

The related `mdd` frontend/server, `mdd-build-flow-action` deployment primitive, and `build-flow-action` orchestrator are separate repositories. Keep their responsibilities out of this package.

Current stage: implement and maintain the headless engine. Repository setup, Clean Labels migration, and the v0.1 engine implementation are authorized. Package publication, releases, deployments, and changes to sibling repositories require their own authorized delivery scope.

## Toolchain and runtime

- Use TypeScript.
- Use Bun 1.3.10 for installing dependencies, running development scripts, tests, builds, and packing. Commit `bun.lock`; use frozen installs in CI. Do not introduce competing lockfiles. npm OIDC publication uses the native npm CLI to upload the Bun-packed tarball; it does not replace Bun as the project toolchain.
- Support Node.js 22, 24, and 26, following the compatibility matrix in devin-discord-bot. The package must run without Bun installed on every supported major.
- The default is always the latest Node.js LTS, currently Node 24 as verified on October 3, 2026. The highest tested major is not automatically the default. Recheck LTS status during implementation and deliberate runtime upgrades.
- `.node-version`, `.nvmrc`, examples, and the default production runtime use the latest LTS; pin resolved versions for reproducible builds. Package `engines.node` describes the supported range rather than only that default. The reference range is `>=22.0.0`; verify the minimum against selected dependencies before publishing and document any higher required patch.
- CI includes Node 22, 24, and 26 independently of the default. Keep the supported range, compatibility matrix, and documentation aligned; review support as Node releases enter or leave support.
- Compile runtime code for Node. Bun-specific APIs are allowed in development tooling/tests, not shipped runtime code. Do not ship a Bun-targeted bundle as a Node package.
- Run TypeScript checking and emit declarations explicitly; Bun transpilation alone does neither.
- Run the same built/packed-package smoke check in real Node 22, 24, and 26 processes. Passing Bun tests or merely installing a Node matrix is not sufficient evidence of Node compatibility. Verify the declared minimum version before publishing, as well as current patches in the supported majors.
- Use maintained Markdown tooling, platform features, and the smallest correct implementation before adding dependencies or abstractions.

## Architecture boundaries

The engine owns config/content validation, Markdown/components, metadata, routes/navigation, headings, local link resolution, asset discovery, and diagnostics.

It does not own repository cloning, credentials, web serving, full frontend layouts, theme JavaScript execution, deployment APIs, or hosted accounts. Return framework-independent models and article fragments for mdd to compose.

Default author input is `mdd/config.json` plus `mdd/contents/` and optional `mdd/themes/`. Support configured paths safely within the local project. Plugins are deferred. Do not add extension frameworks or inactive plugin settings ahead of requirements.

Preserve deterministic output, useful file/line diagnostics, validated links/paths, and portable base paths. Do not execute arbitrary code from documentation or silently ignore invalid configuration.

## Clean Workflow

The user explicitly adopted WG Tech Labs Clean Workflow. Use the installed `clean-workflow:clean-workflow` skill and its applicable Clean Commit, Clean Flow, Clean Labels, and review-handling references. Its canonical project is [wgtechlabs/clean-workflow](https://github.com/wgtechlabs/clean-workflow). Do not depend on a contributor having the original author's absolute skill path.

Clean Workflow governs Git and delivery. Follow the user's implementation sequence proportionately: Grilling for unsettled decisions, APEX for Analyze/Plan/Execute/eXamine, and Thermo-Nuclear review for substantial code. Load the Clean Coding or Clean Code Review skill when routed by Clean Workflow. Reuse existing analysis/checks rather than duplicating work. UI-specific Impeccable/polish stages belong to mdd; this headless package does not need a UI.

### Branches and merges

- Use stable `main`, integration `dev`, and short-lived descriptive branches from `dev`.
- Target feature/fix/docs PRs at `dev`; squash merge those PRs.
- Promote `dev` to `main` with a regular merge commit, never a squash promotion.
- Use a meaningful `🚀 release:` title for the promotion PR.
- Avoid direct commits to established `main` or `dev`; inspect state and preserve unrelated work.
- The initial remote is empty. Establish the bootstrap branches when implementation/setup is authorized; do not pretend an existing `dev` base is available or rewrite history to manufacture one.

### Commits

Use `<emoji> <type>: <description>` or `<emoji> <type> (<scope>): <description>`; add `!` to the type for a breaking change. Use lowercase type/description, present tense, no final period, and fewer than 72 characters where practical.

| Type | Emoji |
|---|---|
| `new` | 📦 |
| `update` | 🔧 |
| `remove` | 🗑️ |
| `security` | 🔒 |
| `setup` | ⚙️ |
| `chore` | ☕ |
| `test` | 🧪 |
| `docs` | 📖 |
| `release` | 🚀 |

Use GHLT for authorized Clean Labels template setup. Preserve existing labels; adoption does not authorize a destructive label migration. Inspect the current PR head and existing review threads before review work; only post replies or resolve threads within the user's authorized scope.

## Build, package, and release policy

Use `wgtechlabs/build-flow-action` reusable workflows rather than inventing a new release pipeline. Package and release flows must be enabled for this repository, with both npm and GitHub Packages selected:

```yaml
with:
  ci-profile: node-bun
  ci-matrix-versions: '["22","24","26"]'
  enable-package: true
  enable-release: true
  package-registry: both
  package-npm-auth-method: oidc
  package-manager: bun
  release-package-manager: bun
```

The caller is [.github/workflows/build.yml](.github/workflows/build.yml). This migration uses a reviewed immutable Build Flow integration commit for CI; replace it with the released orchestrator commit before merging. The package primitive is the released v2.3.0. Do not claim OIDC is active from an action release or a validation run alone. Package publication and GitHub Release creation are enabled for eligible pushes to `main`; dev, PR, and manual artifact publication are disabled. Promoting a PR to `main` can publish a release, so require explicit merge/release authorization and follow [docs/RELEASING.md](docs/RELEASING.md).

Use explicit Bun install/lint/typecheck/test/coverage/build commands supported by the package. The inspected `node-bun` defaults contain npm fallbacks; a failed Bun check must not turn into a successful fallback. Keep required security checks and run the Node package smoke check under each configured Node matrix version as part of the build gate. Do not claim that a parallel CodeQL job gates release unless its dependencies enforce that.

Use one compatible package identity/version for both registries: `@wgtechlabs/mdd-engine`. Confirm license, registry access, package contents, and public visibility before publishing. The npm authentication is Trusted Publishing with OIDC, using npm CLI >=11.5.1 on the pinned Node 24.21.0 runtime. Retain `package-npm-auth-method: oidc` when adopting the released orchestrator. Configure npm to trust `wgtechlabs/mdd-engine` / `build.yml`, allow direct `npm publish`, and preserve `id-token: write` through the reusable workflow chain. OIDC publishing must not require or fall back to `NPM_TOKEN`. GitHub Packages still uses the separate built-in `GITHUB_TOKEN` with `packages: write`, and GitHub Releases require `contents: write`. Never hardcode or log tokens; retain permissions required by enabled comments or security features.

The first npm publication needs a one-time bootstrap if the package is absent. Use the preserved validated `0.1.0` tarball tied to the existing `v0.1.0` tag at finalized commit `3975075b4dee44806012e71d80e858ddcf2b39a9`; follow the verification and maintainer-authentication procedure in [docs/RELEASING.md](docs/RELEASING.md). Never rewrite the tag, duplicate an existing registry version, or blindly rerun a partial publication. Future eligible releases use automatic OIDC after the trusted publisher and workflow adoption are verified.

Required sequencing: validate source → finalize release source/version → build package → confirm successful publication to BOTH registries → publish GitHub Release. Partial registry publication is incomplete and must not unlock release. Do not silently change existing primitive defaults; document consumer policy overrides such as non-main artifact publishing.

### Release gate contract

The package primitive reports aggregate success if either registry succeeds. The pinned Build Flow revision separately requires all selected registries to publish and the complete package job to succeed before GitHub Release. Required CI and CodeQL must succeed before source finalization or publication.

Preserve these guarantees when upgrading the upstream revision. Verify that failure on either registry, a later package step, or required security analysis blocks the release. Do not replace these checks with the primitive's aggregate output or change its documented meaning.

## Verification and completion

Use focused fixture-based Bun tests for content behavior and the same separate Node smoke check for the built package on Node 22, 24, and 26. Cover real failure boundaries rather than duplicating every helper. At minimum verify default/custom paths, collisions, links/anchors, components, deterministic output, and `/`, `/docs/`, `/repository/docs/` prefixes.

Before completing substantial implementation: review the final diff, run relevant lint/typecheck/tests/build/security checks, perform the required maintainability review, and record gaps honestly. Do not report package publication, GitHub release, or deployment from a requested/queued operation; verify the actual result.
