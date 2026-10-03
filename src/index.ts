import { readFile } from "node:fs/promises";
import { resolveLinks, type SourcePage } from "./links.js";
import { parseDocument, renderDocument } from "./markdown.js";
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
  Page,
} from "./types.js";

export type {
  Asset,
  CompileOptions,
  CompileResult,
  Diagnostic,
  Heading,
  Metadata,
  NavigationItem,
  Page,
  Site,
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
    const document = parseDocument(
      await readFile(file, "utf8"),
      source,
      diagnostics,
    );
    sources.push({ file, relative, route, document });
  }
  const assets = await resolveLinks(sources, project, basePath, diagnostics);
  if (diagnostics.some((item) => item.severity === "error"))
    return { diagnostics };
  const pages: Page[] = [];
  for (const source of sources) {
    const { document } = source;
    const rendered = await renderDocument(document);
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
    },
    diagnostics,
  };
}
