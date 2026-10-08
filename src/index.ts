import { readFile } from "node:fs/promises";
import { parseFooter } from "./footer.js";
import { resolveLinks, type SourcePage } from "./links.js";
import {
  type ParsedDocument,
  parseDocument,
  renderDocument,
} from "./markdown.js";
import { loadProject, relativeSource } from "./project.js";
import {
  navigationFor,
  normalizeBasePath,
  publicUrl,
  routeFor,
} from "./routes.js";
import type {
  CompileOptions,
  CompileResult,
  Diagnostic,
  Footer,
  Page,
} from "./types.js";

export {
  type SearchIndex,
  type SearchOptions,
  type SearchPage,
  type SearchResult,
  type SearchSection,
  search,
  validateSearchIndex,
} from "./search.js";
export { createSearchIndex } from "./search-index.js";

export type {
  Asset,
  CompileOptions,
  CompileResult,
  Diagnostic,
  Footer,
  Heading,
  Metadata,
  NavigationItem,
  Page,
  Site,
  SocialLink,
  Theme,
} from "./types.js";

const reserved = new Set([
  "_assets",
  "_mdd",
  "markdown",
  "mdd-build.json",
  "llms.txt",
  "sitemap.xml",
  "robots.txt",
  "404.html",
]);

function nestingDiagnostic(error: unknown, file: string): Diagnostic {
  // V8 reports this error for excessive nesting in both parsing and rendering.
  if (
    !(error instanceof RangeError) ||
    error.message !== "Maximum call stack size exceeded"
  )
    throw error;
  return {
    severity: "error",
    code: "CONTENT_TOO_DEEP",
    message:
      "Markdown nesting is too deep; reduce nested blocks or formatting.",
    file,
  };
}

/** Compile a local checkout; never fetch repositories, execute author code, or emit files. */
export async function compileProject(
  options: CompileOptions,
): Promise<CompileResult> {
  const diagnostics: Diagnostic[] = [];
  let basePath: string;
  try {
    basePath = normalizeBasePath(options.basePath ?? "/");
  } catch (error) {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "INVALID_BASE_PATH",
          message: error instanceof Error ? error.message : "Invalid basePath",
        },
      ],
    };
  }
  const project = await loadProject(options, diagnostics);
  if (!project) return { diagnostics };
  let footer: Footer | undefined;
  if (project.footer) {
    const source = relativeSource(project.root, project.footer);
    const text = await readFile(project.footer, "utf8");
    try {
      footer = parseFooter(text, source, diagnostics);
    } catch (error) {
      diagnostics.push(nestingDiagnostic(error, source));
      return { diagnostics };
    }
  }
  const sources: SourcePage[] = [];
  const routes = new Map<string, string>();
  for (const file of project.files) {
    const relative = relativeSource(project.contentsRoot, file);
    const source = relativeSource(project.root, file);
    const route = routeFor(relative);
    const key = decodeURIComponent(route).normalize("NFC").toLowerCase();
    if (reserved.has(key.split("/")[1] ?? "")) {
      diagnostics.push({
        severity: "error",
        code: "RESERVED_ROUTE",
        message: `Route '${route}' is reserved for generated output`,
        file: source,
      });
    }
    const conflict = routes.get(key);
    if (conflict)
      diagnostics.push({
        severity: "error",
        code: "ROUTE_COLLISION",
        message: `Route '${route}' collides with ${conflict}`,
        file: source,
      });
    routes.set(key, source);
    const text = await readFile(file, "utf8");
    let document: ParsedDocument;
    try {
      document = parseDocument(text, source, diagnostics);
    } catch (error) {
      diagnostics.push(nestingDiagnostic(error, source));
      return { diagnostics };
    }
    sources.push({ file, relative, route, document });
  }
  const assets = await resolveLinks(sources, project, basePath, diagnostics);
  if (diagnostics.some((item) => item.severity === "error"))
    return { diagnostics };
  const pages: Page[] = [];
  for (const source of sources) {
    const { document } = source;
    let rendered: { html: string; markdown: string };
    try {
      rendered = await renderDocument(document);
    } catch (error) {
      diagnostics.push(
        nestingDiagnostic(error, relativeSource(project.root, source.file)),
      );
      return { diagnostics };
    }
    pages.push({
      source: relativeSource(project.root, source.file),
      route: source.route,
      url: publicUrl(basePath, source.route),
      title: document.title,
      ...(document.metadata.description !== undefined
        ? { description: document.metadata.description }
        : {}),
      ...rendered,
      headings: document.headings,
      navigation: {
        title: document.metadata.navTitle ?? document.title,
        ...(document.metadata.order !== undefined
          ? { order: document.metadata.order }
          : {}),
      },
    });
  }
  return {
    site: {
      title:
        project.title ??
        pages.find((page) => page.route === "/")?.title ??
        "Documentation",
      basePath,
      pages,
      navigation: navigationFor(
        pages,
        sources.map((source) => source.relative),
      ),
      assets,
      theme: project.theme,
      ...(footer ? { footer } : {}),
    },
    diagnostics,
  };
}
