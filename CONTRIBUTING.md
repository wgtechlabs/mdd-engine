# Contributing

Use Bun 1.3.10 with the Node version in `.nvmrc` or `.node-version`. Node defaults track the latest LTS; compatibility checks cover 22, 24, and 26. Keep the runtime free of Bun APIs.

Read [AGENTS.md](AGENTS.md) and [the engine contract](docs/SPEC.md) before making changes. The frontend, server, Git fetching, and deployment actions belong to separate repositories.

## Clean Workflow

1. Branch from `dev` using `feature/`, `fix/`, `docs/`, `test/`, `chore/`, or `refactor/` plus a short descriptive name.
2. Run `bun install --frozen-lockfile`, `bun run check`, `bun run coverage`, and `bun audit` as relevant to the change. Add meaningful regression tests for changed behavior.
3. Open a pull request targeting `dev`. Use the existing Clean Labels to identify its type and area.
4. Squash feature pull requests into `dev`. Promote `dev` to `main` using a regular merge commit and a `🚀 release:` title.

Use Clean Commit messages: `<emoji> <type>: <lowercase description>` or `<emoji> <type> (<scope>): <description>`. Types and their exact emojis are listed in [AGENTS.md](AGENTS.md). Avoid a final period and aim for fewer than 72 characters.

Labels are managed through [GHLT](https://github.com/warengonzaga/github-labels-template). Routine template updates use `ghlt apply --repo wgtechlabs/mdd-engine`; a destructive `migrate` requires explicit authorization. The initial migration has already been completed.

Follow [the release prerequisites and build channels](docs/RELEASING.md): eligible PRs targeting `dev` publish `pr` previews; pushes to `dev` and `dev` → `main` PRs publish `dev` previews. Other PRs targeting `main` publish `patch` previews, and manual runs publish `wip` previews. Eligible pushes to `main` publish regular packages before creating a GitHub Release. Both npm and GitHub Packages are enabled through Build Flow defaults. Pushing to an open PR can publish a new preview; a feature-branch push without an eligible PR does not trigger this workflow.
