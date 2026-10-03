import path from "node:path";
import type { Definition, Image, Link } from "mdast";
import { visit } from "unist-util-visit";
import type { ParsedDocument } from "./markdown.js";
import {
  AuthoringError,
  isWithin,
  type Project,
  relativeSource,
  safeFile,
} from "./project.js";
import { encodePath, publicUrl } from "./routes.js";
import type { Asset, Diagnostic } from "./types.js";

export interface SourcePage {
  file: string;
  relative: string;
  route: string;
  document: ParsedDocument;
}

// Active file formats belong to an explicitly selected theme, never content assets.
const assetExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".pdf",
  ".txt",
]);

export async function resolveLinks(
  pages: SourcePage[],
  project: Project,
  basePath: string,
  diagnostics: Diagnostic[],
): Promise<Asset[]> {
  const byFile = new Map(pages.map((page) => [page.file, page]));
  const byRoute = new Map(
    pages.map((page) => [decodeURIComponent(page.route), page]),
  );
  const assets = new Map<string, Asset>();
  const destinations = new Map<string, string>();
  for (const page of pages) {
    const links: (Link | Image | Definition)[] = [];
    const imageReferences = new Set<string>();
    visit(page.document.tree, (node) => {
      if (node.type === "imageReference") imageReferences.add(node.identifier);
      if (
        node.type === "link" ||
        node.type === "image" ||
        node.type === "definition"
      )
        links.push(node);
    });
    for (const node of links) {
      const isImage =
        node.type === "image" ||
        (node.type === "definition" && imageReferences.has(node.identifier));
      const url = node.url;
      // Protocol validation is owned by the parser. Do not fetch external targets.
      if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//")) continue;
      const location = {
        file: relativeSource(project.root, page.file),
        line: node.position?.start.line,
        column: node.position?.start.column,
      };
      try {
        const hashIndex = url.indexOf("#");
        const beforeHash = hashIndex < 0 ? url : url.slice(0, hashIndex);
        const hash =
          hashIndex < 0 ? "" : decodeURIComponent(url.slice(hashIndex + 1));
        const queryIndex = beforeHash.indexOf("?");
        const pathname =
          queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex);
        const query = queryIndex < 0 ? "" : beforeHash.slice(queryIndex);
        const decoded = decodeURIComponent(pathname);
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Local paths cannot include controls.
        if (/[\\\u0000-\u001f\u007f]/u.test(decoded))
          throw new AuthoringError(
            "INVALID_LINK",
            "Local links cannot contain backslashes or control characters",
          );
        const targetFile = decoded.startsWith("/")
          ? path.resolve(project.contentsRoot, `.${decoded}`)
          : path.resolve(
              path.dirname(page.file),
              decoded || path.basename(page.file),
            );
        if (!isWithin(project.contentsRoot, targetFile))
          throw new AuthoringError(
            "PATH_ESCAPE",
            "Local links must stay inside the content root",
          );
        let target = !decoded ? page : byFile.get(targetFile);
        const extension = path.extname(decoded).toLowerCase();
        let assetExists = false;
        if (
          !target &&
          !decoded.endsWith("/") &&
          assetExtensions.has(extension)
        ) {
          try {
            await safeFile(project.contentsRoot, targetFile);
            assetExists = true;
          } catch (error) {
            // An absent file or directory may still name a dotted page route.
            // Safety and operational errors must never become route fallbacks.
            if (
              !(error instanceof AuthoringError) ||
              !["PATH_NOT_FOUND", "INVALID_FILE_TYPE"].includes(error.code)
            )
              throw error;
          }
        }
        if (!target && !assetExists) {
          const relative = relativeSource(project.contentsRoot, targetFile);
          const route = relative ? `/${relative.replace(/\/$/, "")}/` : "/";
          target = byRoute.get(route);
        }
        if (target) {
          if (isImage)
            throw new AuthoringError(
              "INVALID_IMAGE",
              "Images must reference an asset, not a Markdown page",
            );
          let anchor = "";
          if (hash) {
            const heading = target.document.headings.find(
              (item) => item.id === hash || item.id === `mdd-${hash}`,
            );
            if (!heading)
              throw new AuthoringError(
                "MISSING_ANCHOR",
                `No heading '${hash}' in ${target.relative}`,
              );
            anchor = `#${encodeURIComponent(heading.id)}`;
          }
          node.url = publicUrl(basePath, target.route) + query + anchor;
          continue;
        }
        if (
          decoded.toLowerCase().endsWith(".md") ||
          decoded.endsWith("/") ||
          !decoded ||
          !path.extname(decoded)
        ) {
          throw new AuthoringError(
            "MISSING_LINK",
            `No documentation page matches '${url}'`,
          );
        }
        if (!assetExtensions.has(extension)) {
          throw new AuthoringError(
            "UNSUPPORTED_ASSET",
            `Unsupported asset '${decoded}'. Use a raster image, PDF, or plain text file`,
          );
        }
        if (isImage && [".pdf", ".txt"].includes(extension)) {
          throw new AuthoringError(
            "INVALID_IMAGE",
            "Images must reference a supported raster image",
          );
        }
        if (!assetExists) await safeFile(project.contentsRoot, targetFile);
        const source = relativeSource(project.root, targetFile);
        const destination = `_assets/${relativeSource(project.contentsRoot, targetFile)}`;
        const key = destination.normalize("NFC").toLowerCase();
        const existing = destinations.get(key);
        if (existing && existing !== source)
          throw new AuthoringError(
            "ASSET_COLLISION",
            `Asset output collides with ${existing}`,
          );
        destinations.set(key, source);
        const asset = {
          source,
          destination,
          url: publicUrl(basePath, encodePath(destination)),
        };
        assets.set(source, asset);
        node.url =
          asset.url + query + (hash ? `#${encodeURIComponent(hash)}` : "");
      } catch (error) {
        if (error instanceof AuthoringError)
          diagnostics.push({
            severity: "error",
            code:
              error.code === "PATH_NOT_FOUND" ? "MISSING_ASSET" : error.code,
            message: error.message,
            ...location,
          });
        else if (error instanceof URIError)
          diagnostics.push({
            severity: "error",
            code: "INVALID_LINK",
            message: `Malformed URL encoding in '${url}'`,
            ...location,
          });
        else if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          diagnostics.push({
            severity: "error",
            code: "MISSING_ASSET",
            message: `Asset not found: '${url}'`,
            ...location,
          });
        else
          throw new Error(`Unable to resolve '${url}' in ${location.file}`, {
            cause: error,
          });
      }
    }
  }
  return [...assets.values()].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );
}
