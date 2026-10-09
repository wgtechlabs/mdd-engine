# mdd-engine specification

Status: v0.1 engine implemented for review. Product boundaries and toolchain were confirmed by the user on October 3, 2026. Publication remains locked; see RELEASING.md and VERIFICATION.md.

## Purpose and ownership

`mdd-engine` is a headless TypeScript package that compiles a local documentation project into a framework-independent site model and rendered article fragments. It must work independently of mdd, a browser, and a running server.

Own configuration/content validation, Markdown/component rendering, metadata, navigation, heading anchors, local link resolution, asset discovery, and structured diagnostics. Leave repository fetching, frontend layout, theme application, static file emission, HTTP serving, credentials, and deployment to mdd or its action.

The engine also owns shared social-footer validation and headless search indexing/querying. MDD owns the footer layout, social icons, index delivery, and search interaction. Themes style these interfaces.

There is one content compiler. mdd and CI consume this contract rather than recreating it.

## Toolchain and package

- Bun manages dependencies, the committed `bun.lock`, scripts, tests, and builds.
- Support Node.js 22, 24, and 26. The default development/runtime version remains the latest Node.js LTS, currently Node 24 as verified on October 3, 2026. Recheck LTS status and pin resolved versions when implementing or upgrading; testing Node 26 does not make it the default.
- `.node-version` and `.nvmrc` select that LTS default. Package `engines.node` declares compatibility across supported versions; use the reference range `>=22.0.0` only after verifying the minimum against dependencies and the built package. Record a higher minimum patch explicitly if required.
- Build Flow uses `ci-matrix-versions: '["22","24","26"]'`. The supported range and test matrix are separate from the single default runtime.
- Compile server/package code for Node, never the Bun runtime. Do not use `Bun.*` or `bun:*` in shipped runtime code. Build scripts and tests may use Bun.
- Bun's bundler does not typecheck or emit declarations: run TypeScript checks and declaration emission explicitly.
- Run a real Node smoke test against the same packed package under Node 22, 24, and 26, not just Bun tests. Also verify the lowest version claimed by package metadata before publishing.
- Proposed package identity: `@wgtechlabs/mdd-engine`; verify npm scope/name access before publishing. Publish the same version to npm and GitHub Packages, then a GitHub Release through Build Flow.
- Prefer ESM and TypeScript declarations for v0.1; add CommonJS only if a concrete consumer requires it.

Sources: [Node releases](https://nodejs.org/en/about/previous-releases), [Bun build targets and TypeScript limitations](https://bun.sh/docs/bundler), [Bun lockfile](https://bun.sh/docs/pm/lockfile).

## Public API

```ts
compileProject({
  projectDir,
  mddDir: 'mdd',
  basePath: '/'
}): Promise<CompileResult>
```

`projectDir` is an existing local checkout. The engine does not clone it. `mddDir` is relative to that project. `basePath` is the effective public prefix supplied by mdd, including any host prefix; it is normalized once to a leading/trailing slash.

| Result | Contract |
|---|---|
| `site` | Present only when no error diagnostics exist |
| `site.title`, `site.basePath` | Resolved site identity and deployment prefix |
| `site.pages` | Source path, logical route, public URL, title, optional description, article HTML, normalized Markdown for readers, headings, navigation metadata |
| `site.navigation` | Ordered page/group tree |
| `site.assets` | Explicit files needed by content, with source and destination mappings |
| `site.theme` | Resolved theme selection and locations for mdd to apply |
| `site.footer` | Optional project-relative shared footer source and ordered `{ label, url }` social links |
| `diagnostics` | Stable code, severity, message, file and line/column where available |

Keep parser ASTs and frontend framework types private. Expected authoring failures become diagnostics. Unexpected operational failures must retain useful context and fail the build. Do not silently produce a publishable partial site.

`createSearchIndex(site): SearchIndex` builds versioned JSON data from successfully compiled pages. `search(index, query, { limit?, mode?, fuzzy? }): SearchResult[]` returns validated page/section URLs, plain-text excerpts, breadcrumbs, and original-text match ranges. The default mode preserves one hit per matching page; opt-in section mode returns multiple matching headings and supports bounded typo correction. `validateSearchIndex(unknown)` validates and narrows deserialized data. Import queries/validation/types from `@wgtechlabs/mdd-engine/search` for dependency-free browser use; compilation and index construction belong to the package root. See [SEARCH.md](SEARCH.md) for schema, deterministic ranking, bounds, and text-rendering requirements.

## Configuration and directory contract

```text
mdd/
  config.json
  footer.md                 # optional; shared socials only
  contents/
    index.md
    get-started/index.md
    get-started/installation.md
    faqs/index.md
    assets/logo.png
  themes/
    custom/theme.css
    custom/theme.js
```

`config.json`:

```json
{
  "title": "My Project",
  "paths": {
    "contents": "./contents",
    "themes": "./themes"
  },
  "theme": "custom"
}
```

All fields are optional. Without config, use `contents/`, `themes/`, the built-in default theme, and the home page title. A custom theme folder is required only when selected. Invalid supplied settings fail rather than falling back silently.

Custom paths resolve from the configuration directory. They may point elsewhere inside the checked-out project; prevent escaping the project through traversal or symlinks. Reject overlapping content/theme roots that would make discovery ambiguous. Scan only the selected content root and referenced assets; never publish `.git`, environment files, or arbitrary project files.

Require a content root and `index.md` homepage in v0.1. Keep generated output outside scanned content. `plugins/` is reserved future scope: do not create a loader or accept plugin settings that do nothing.

Optional `footer.md` lives directly in the resolved `mddDir`. Missing/blank means no footer. A nonblank file must contain exactly one `:::socials` block with a flat unordered list of plain-text labeled HTTPS links. Invalid content fails compilation with source diagnostics. It is never an article, including when the configured content root contains it. Other files named `footer.md` remain normal content. See [FOOTER.md](FOOTER.md) for validation details.

## Routes, navigation, and links

| Relative content path | Logical route |
|---|---|
| `index.md` | `/` |
| `get-started/index.md` | `/get-started/` |
| `get-started/installation.md` | `/get-started/installation/` |
| `faqs/index.md` | `/faqs/` |

Preserve folder/file stems, encoding URL segments correctly. Recommend kebab-case in examples, but do not silently rename underscores or existing paths. Detect `guide.md` versus `guide/index.md`, case-insensitive collisions, and collisions with generated asset/metadata routes.

Folders form navigation groups. A folder index provides the landing page and group metadata; without an index, the group is non-clickable. Optional YAML frontmatter supports only `title`, `description`, `navTitle`, and numeric `order` initially.

Title precedence: frontmatter title, first H1, readable filename. Navigation label: `navTitle`, then title. Explicitly ordered siblings sort first, then deterministic label/path ordering. Heading IDs use `mdd-` plus github-slugger output, including duplicate suffixes. Human fragment links without the prefix are resolved and rewritten to the final ID.

Resolve relative `.md` links and local image references against their source file, then map to public routes. For v0.1, leading-slash content links address the documentation root, not an unrelated host homepage; prepend the effective base path. External absolute URLs remain external. Validate local targets and anchors after all pages are known. Do not make network requests to validate external links during compilation.

## Markdown components and headless output

Use an established Markdown parser with a documented GFM subset (tables, task lists, strikethrough), GitHub-style alerts, and a `details` directive.

```markdown
> [!NOTE]
> An ordinary Markdown paragraph inside an alert.

:::details[More information]
Additional Markdown content.
:::
```

Alerts are root-level blockquotes whose opening line contains exactly one uppercase marker: `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]`. Preserve ordinary Markdown bodies and apply the same link, heading, asset, and security validation as elsewhere. Nested blockquotes, lowercase or unknown markers, and markers sharing their line with body text remain ordinary blockquotes. Alert syntax adds no custom title or attribute syntax.

The engine emits `<aside class="mdd-alert mdd-note">` for a note, with the corresponding lowercase type class for the other alerts. Its first child is `<p class="mdd-component-label"><strong>Note</strong></p>`; the visible labels are Note, Tip, Important, Warning, and Caution. These are static article content, without live-region roles. Normalized Markdown preserves the `> [!TYPE]` marker and body. The reader composes the article into a page; themes own colors, icons, borders, and spacing. See [the alert contract](ALERTS.md) for all hooks and examples.

The removed `:::note`, `:::tip`, and `:::warning` directives produce an actionable `REMOVED_COMPONENT` error identifying the replacement alert syntax and how to retain an optional custom title in the body. They must not silently drop content or continue as aliases. `:::details` retains its existing `details`/`summary` output, optional label, and `mdd-details` hook. Validate supported names/attributes; unknown directives produce an actionable error instead of dropping text. Markdown is permissive, so do not promise that every malformed delimiter can be detected.

Disable raw author HTML in v0.1 and escape/sanitize generated content and unsafe URL schemes. Do not evaluate MDX, template expressions, config JavaScript, or theme JavaScript. Preserve readable component labels/bodies in the normalized Markdown output for agents, without navigation HTML or executable content.

Sources: [remark-gfm](https://github.com/remarkjs/remark-gfm), [remark-directive](https://github.com/remarkjs/remark-directive). Final dependency versions are selected during implementation.

## Acceptance criteria

1. A small fixture compiles in plain Node 22, 24, and 26 consumers without importing mdd or starting a server.
2. Identical inputs produce deterministic models, anchors, routes, and diagnostics.
3. Folder/index navigation, metadata overrides, and assets work at `/`, `/docs/`, and `/repository/docs/`.
4. Invalid JSON/schema, missing home page, path escapes, collisions, bad local links, and unsupported components fail with useful locations.
5. Ordinary Markdown works without a theme or custom components.
6. Component content is readable in both HTML fragments and normalized Markdown.
7. The packed package contains runtime JavaScript and types, excludes secrets/build debris, and runs under all three supported Node majors without Bun installed; the declared minimum is verified before publication.
8. Build Flow validates, builds, and publishes the same release version to both registries before GitHub Release completion is reported.
9. Optional social-footer metadata is deterministic, safely validated, and excluded from pages, navigation, and search.
10. Serialized search preserves compiled encoded paths and duplicate-heading anchors at all supported base paths; its standalone query module bundles for browsers without compiler or Node dependencies.

Use a small fixture-based Bun test suite plus one Node package smoke check reused across the compatibility matrix. Exact parser dependencies and API field names may be refined before the first release; preserve these ownership boundaries.

## v0.1 implementation details

The implementation exports `compileProject` and its framework-independent types from the package root. It emits Node ESM and declarations. Content discovery rejects symlink entries, while configured directories are resolved within the checkout. Active content asset formats are deferred: v0.1 accepts raster images (PNG/JPEG/GIF/WebP/AVIF/ICO), PDF, and plain text. Asset bytes are not sanitized; serving policy belongs to mdd. `_assets/`, `_mdd/`, `markdown/`, `mdd-build.json`, `llms.txt`, `sitemap.xml`, `robots.txt`, and `404.html` are reserved output paths. Custom theme files remain a separate trusted boundary and are never executed by this engine.

The dual-registry publication acceptance criterion is a pre-release gate. Local engine completion does not imply package publication or a GitHub Release.
