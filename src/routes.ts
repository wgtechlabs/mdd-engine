import path from "node:path";
import type { NavigationItem, Page } from "./types.js";

export function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

export function normalizeBasePath(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters at the URL boundary.
  const invalidPath = /[?#\\\u0000-\u0020]/u.test(value);
  if (invalidPath || value.includes(":") || value.startsWith("//")) {
    throw new Error(
      "basePath must be a URL path without a host, query, fragment, or whitespace",
    );
  }
  const parts = value.split("/").filter(Boolean);
  const decoded = parts.map((part) => decodeURIComponent(part));
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject decoded controls and path separators.
  const invalidSegment = /[/\\\u0000-\u0020]/u;
  if (
    decoded.some(
      (part) => part === "." || part === ".." || invalidSegment.test(part),
    )
  ) {
    throw new Error(
      "basePath must not contain traversal or encoded separators",
    );
  }
  return parts.length ? `/${decoded.map(encodeURIComponent).join("/")}/` : "/";
}

export function routeFor(source: string): string {
  const stem = source.slice(0, -3);
  const route = stem === "index" ? "" : stem.replace(/\/index$/, "");
  return route ? `/${encodePath(route)}/` : "/";
}

export function publicUrl(basePath: string, route: string): string {
  return basePath + route.replace(/^\//, "");
}

export function readableName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/^./u, (char) => char.toUpperCase());
}

interface Entry {
  key: string;
  title: string;
  page?: Page;
  children: Map<string, Entry>;
}

export function navigationFor(
  pages: Page[],
  relativeFiles: string[],
): NavigationItem[] {
  const root: Entry = { key: "", title: "", children: new Map() };
  pages.forEach((page, index) => {
    const source = relativeFiles[index];
    if (!source) return;
    const segments = source.split("/");
    const file = segments.pop();
    let parent = root;
    for (const folder of segments) {
      let group = parent.children.get(folder);
      if (!group) {
        group = {
          key: folder,
          title: readableName(folder),
          children: new Map(),
        };
        parent.children.set(folder, group);
      }
      parent = group;
    }
    if (file?.slice(0, -3) === "index" && parent !== root) {
      parent.page = page;
      parent.title = page.navigation.title;
    } else {
      const key =
        source === "index.md"
          ? ""
          : path.posix.basename(source, path.posix.extname(source));
      parent.children.set(key, {
        key,
        title: page.navigation.title,
        page,
        children: new Map(),
      });
    }
  });
  function sorted(entry: Entry): NavigationItem[] {
    return [...entry.children.values()]
      .sort((a, b) => {
        const order =
          (a.page?.navigation.order ?? Infinity) -
          (b.page?.navigation.order ?? Infinity);
        if (order && !Number.isNaN(order)) return order;
        return compare(a.title, b.title) || compare(a.key, b.key);
      })
      .map((child) => ({
        title: child.title,
        ...(child.page ? { route: child.page.route, url: child.page.url } : {}),
        ...(child.children.size ? { children: sorted(child) } : {}),
      }));
  }
  return sorted(root);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
