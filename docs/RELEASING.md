# Releasing mdd-engine

## Current state: validation enabled, publishing locked

[Build Flow](../.github/workflows/build.yml) calls `wgtechlabs/build-flow-action` v0.3.1 at immutable commit `260b9a063ef59ccc760155c19902320feb7e25cb`. Package and release flows are configured, with npm and GitHub Packages selected, but publication is deliberately disabled until the prerequisites below are satisfied. No repository variable can bypass this lock.

Pull requests to `dev`/`main`, pushes to those branches, and manual runs execute validation. The caller disables dev, PR, and manual artifact publishing as an explicit consumer policy. On main, the upstream version plan is a dry run with a read-only token. `package-publish-enabled: false` prevents source finalization, version/changelog commits, tags, and package publishing; `release-create: false` additionally prevents a GitHub Release. Container publishing remains disabled by the upstream default.

Do not remove one lock merely to make a release run. The current upstream cannot enforce this repository's dual-registry requirement.

## Toolchain and checks

- `packageManager: bun@1.3.10` in `package.json` selects Bun through the upstream `setup-bun` action. CI also checks the installed version. Commit `bun.lock`; frozen installs must fail on drift.
- Node 24.21.0 is the pinned default LTS runtime. The CI matrix selects current patches of Node 22, 24, and 26 independently of that default.
- CI explicitly runs `lint`, `typecheck`, `test`, `coverage`, and `build` through Bun. It then runs `smoke`, which must execute the packed package with the real Node binary in that matrix job. Bun tests alone do not demonstrate Node compatibility.
- All CI command overrides fail on an error. They deliberately replace upstream's `bun ... || npm ... --if-present` defaults, which can hide failures.
- The upstream Gitleaks and CodeQL checks remain enabled. Its CodeQL job runs alongside the release path; v0.3.1 does **not** enforce CodeQL completion before publishing. This must be addressed before removing the release lock so all required security checks gate publication.
- `release-package-manager: bun` configures workspace detection. It is not a Bun runtime installation setting.

## Upstream release prerequisites

Inspection on October 3, 2026 confirmed that [Build Flow v0.3.1](https://github.com/wgtechlabs/build-flow-action/blob/260b9a063ef59ccc760155c19902320feb7e25cb/.github/workflows/app.yml) pins package primitive v2.2.0 at `9be4582316267a397955254e0f80cfe0b9454ab2`.

That primitive's [`artifact-published` output](https://github.com/wgtechlabs/package-build-flow-action/blob/9be4582316267a397955254e0f80cfe0b9454ab2/scripts/build-and-publish.sh#L13) is true if **either** registry succeeds. Its [planned publication failure check](https://github.com/wgtechlabs/package-build-flow-action/blob/9be4582316267a397955254e0f80cfe0b9454ab2/scripts/build-and-publish.sh#L422) fails only when neither succeeds. Build Flow's [GitHub Release gate](https://github.com/wgtechlabs/build-flow-action/blob/260b9a063ef59ccc760155c19902320feb7e25cb/.github/workflows/app.yml#L1237) checks that aggregate output without requiring the package job itself to have succeeded. A partial registry publication, or a failure after publication, can therefore unlock the GitHub Release.

Before the first production release, select a reviewed upstream revision that enforces all of these conditions:

1. Required validation and security jobs succeed before publication.
2. Release source/version is finalized once; the package is built from that exact finalized commit.
3. Both `npm-published` and `github-published` are true and the complete package job succeeds before the GitHub Release is published.
4. Failure of either registry, a post-publish check, or a required security job prevents the GitHub Release. Verify these failure cases with upstream workflow evidence.

Keep the primitive's documented aggregate output meaning intact. Do not invent unsupported caller inputs or copy release implementation into this repository. The correction belongs in the separately maintained Build Flow projects; this repository should consume its reviewed release.

Registry publishing is not atomic. If one registry succeeds, do not delete a published version or pretend the release completed. Verify the published version and package contents, then use a reviewed recovery path to complete the missing registry. Confirm that recovery before enabling automation.

## First-release checklist

1. Confirm `@wgtechlabs/mdd-engine` ownership and publish access in both registries, the license, intended public visibility, and package repository metadata.
2. Inspect the packed package: runtime JavaScript and declarations present; tests, credentials, caches, and development files excluded. Run the packed-package smoke check in actual Node 22/24/26 and the lowest Node version claimed by `engines.node`.
3. Complete the upstream prerequisites above and update the immutable workflow SHA plus its release-version comment. Verify Bun 1.3.10 selection and default parity at the new pin. The current pin has some floating transitive action references; an immutable caller pin alone does not pin those dependencies.
4. Configure `NPM_TOKEN` as a GitHub Actions secret with the required npm publish access. GitHub Packages and release operations use the built-in `GITHUB_TOKEN`. Never commit tokens or place them in workflow inputs as literal values. Supply any organization-required Gitleaks license through `GITLEAKS_LICENSE`.
5. Preserve the required caller permissions. Review branch protections and GitHub Actions permissions so the release workflow can perform its authorized version commit/tag on main. Configure required CI/security checks before promotion.
6. In a reviewed change, set `package-publish-enabled` and `release-create` to `true`. Keep non-main publication disabled. Removing this lock authorizes the next eligible main push to publish; it is a separate release decision, not part of local package implementation.

## Normal delivery after release readiness

Follow Clean Workflow: work on a short-lived branch from `dev`, squash its pull request into `dev`, and promote `dev` to `main` through a regular merge commit using a meaningful `🚀 release:` title. Use the Clean Commit convention recorded in [AGENTS.md](../AGENTS.md).

The required order is validation → finalized release commit/version → package build → confirmed publication to **both** registries → GitHub Release. After a run, verify the actual npm and GitHub Packages versions and the GitHub Release tag/commit. A queued workflow, accepted publish request, or aggregate publication flag is not completion evidence.
