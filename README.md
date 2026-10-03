# mdd-engine

The headless Markdown documentation compiler behind mdd. Give it a local project; get validated pages, navigation, assets, and article HTML that any frontend can consume.

Built with TypeScript and Bun. Runs on Node.js 22, 24, and 26 without Bun. The default is the latest Node LTS, currently pinned to **24.21.0**.

> Initial implementation. The package has not been published; the npm and GitHub Packages release paths remain locked while upstream release prerequisites are addressed. See [releasing](docs/RELEASING.md).

## A documentation project

```text
my-project/
  mdd/
    config.json           # optional
    contents/
      index.md            # required homepage
      get-started/
        installation.md
      assets/
        logo.png
    themes/
      custom/
        theme.css
        theme.js          # optional; engine never executes it
```

Ordinary Markdown works without configuration. Folder names become routes and navigation groups. For example, `get-started/installation.md` becomes `/get-started/installation/`; a folder's `index.md` becomes its landing page.

```json
{
  "title": "My Project",
  "paths": { "contents": "./contents", "themes": "./themes" },
  "theme": "custom"
}
```

All settings are optional. Custom paths are relative to `mdd/config.json` and must stay within the checkout. Selecting a custom theme requires its `theme.css`. The engine returns theme file locations for the website layer to apply. Plugin loading is deferred.

## Compile without a website

After installing a locally packed copy of `@wgtechlabs/mdd-engine` in your Node project:

```js
import { compileProject } from '@wgtechlabs/mdd-engine';

const result = await compileProject({
  projectDir: '/absolute/path/to/my-project',
  mddDir: 'mdd',
  basePath: '/docs/'
});

if (!result.site) {
  console.error(result.diagnostics);
  process.exitCode = 1;
} else {
  console.log(result.site.pages[0].html);
}
```

`site` is absent whenever authoring errors exist. Diagnostics contain a stable code, severity, message, and source location where available. Unexpected filesystem failures reject the promise with context. Identical inputs produce identical output.

The result includes:

- `pages`: source, route, public URL, title, description, article HTML, readable Markdown, headings, and navigation metadata.
- `navigation`: sorted folder/page tree, with optional landing URLs.
- `assets`: referenced content files with checkout-relative sources, documentation-root-relative destinations, and public URLs.
- `theme`: the built-in default or selected theme file locations.

Paths in the model use forward slashes. Resolve sources against the same `projectDir` used to compile. Asset destinations are filesystem paths, while asset URLs and page routes are URL-encoded. Decode page-route segments when deriving output directories. Prefix asset destinations with the documentation output directory when exporting; do not prefix them with a GitHub repository name a second time. The engine emits no files and starts no server.

## Markdown and components

Supported Markdown includes headings, lists, code fences, links, images, GFM tables, task lists, and strikethrough. Optional YAML frontmatter supports `title`, `description`, `navTitle`, and finite numeric `order`:

```markdown
---
title: Install mdd
navTitle: Installation
order: 1
---
# Installation

:::note[Before you start]
You need a local documentation project.
:::

:::details[More information]
Ordinary **Markdown** works inside components.
:::
```

Use `note`, `tip`, `warning`, or `details` containers. Labels are optional; attributes and unknown component names are errors. Callouts become semantic `aside` elements, disclosures become `details`/`summary`, and each has a stable `mdd-<component>` class. Readable Markdown uses blockquotes with bold labels, without executable content.

Title precedence is frontmatter title, first H1, then readable filename. Navigation uses `navTitle` when supplied. Explicit `order` sorts first; remaining siblings sort deterministically by label and path.

Local `.md` links, extensionless routes, reference links, and images resolve from their source document. A leading slash addresses the documentation root. `basePath` prefixes public links, including `/docs/` and `/repository/docs/`. When a file-style URL matches both an existing supported asset and a page route, the asset wins: `chart.png` selects the image, while `/chart.png/` explicitly selects the page. If no regular asset exists, dotted page routes still resolve. External links are preserved without network requests. Headings have `mdd-`-prefixed GitHub-style slugs; author links such as `#installation` are rewritten to `#mdd-installation`. Duplicate headings receive `-1`, `-2`, and subsequent suffixes.

## Content boundaries

Raw HTML, executable URL schemes, path escapes, unknown configuration, missing local targets, and route collisions fail compilation. MDX is not evaluated; expressions are inert Markdown text, and JSX-style HTML is rejected. Hidden/sensitive paths are excluded. Content discovery rejects symlinks to avoid aliases and traversal; configured roots are resolved and checked against the checkout. Source files must remain stable while compilation and export run.

Referenced content assets are limited to PNG, JPEG, GIF, WebP, AVIF, ICO, PDF, and plain text. SVG, HTML, JavaScript, and CSS are not content assets in this first version. Custom theme CSS/JavaScript is declared separately and must be treated as trusted by the website layer. Asset bytes are not transformed or sanitized; hosts should serve correct media types with `nosniff` and downloads with suitable disposition.

Generated paths `_assets/`, `_mdd/`, `markdown/`, `mdd-build.json`, `llms.txt`, `robots.txt`, `sitemap.xml`, and `404.html` are reserved. Keep generated output outside the content root.

A complete [example project](examples/basic/mdd/contents/index.md) is included under `examples/basic`. Pass that directory as `projectDir` to compile it.

## Develop

```sh
nvm use
bun install --frozen-lockfile
bun run check
bun run coverage
bun audit
```

`bun run build` emits Node ESM and TypeScript declarations to `dist/`. `bun run smoke` creates a package archive, installs it into an isolated consumer, and runs it with the current Node binary. It checks that Bun is unavailable inside the consumer and that all three base-path fixtures compile. On POSIX systems, `MDD_TEST_NODE_BINARIES` can contain colon-separated Node binary paths to exercise the same archive across versions.

Follow [Clean Workflow](AGENTS.md), [contributing](CONTRIBUTING.md), and the [engine contract](docs/SPEC.md). See [verification](docs/VERIFICATION.md) for the checks performed during bootstrap.
