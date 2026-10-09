import { toString as nodeText } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { transformAlerts } from "./alerts.js";
import {
  type SearchIndex,
  type SearchPage,
  type SearchSection,
  validateSearchIndex,
} from "./search.js";
import type { Heading, Page, Site } from "./types.js";

const parser = unified().use(remarkParse).use(remarkGfm);
const blockTypes = new Set(["paragraph", "code", "tableCell", "listItem"]);

function indexPage(page: Page, breadcrumbs: string[]): SearchPage {
  const sections: SearchSection[] = [{ title: "", url: page.url, text: "" }];
  const ancestors: Heading[] = [];
  let headingIndex = 0;
  const chunks: string[][] = [[]];
  const tree = parser.parse(page.markdown);
  transformAlerts(tree, page.markdown);
  visit(tree, (node) => {
    if (node.type === "definition" || node.type === "html") return SKIP;
    if (node.type === "heading") {
      const heading = page.headings[headingIndex++];
      if (
        !heading ||
        heading.text !== nodeText(node) ||
        heading.depth !== node.depth
      ) {
        throw new TypeError(
          "Search indexing requires matching compiled Markdown and headings.",
        );
      }
      while (
        ancestors.length &&
        (ancestors.at(-1)?.depth ?? 0) >= heading.depth
      )
        ancestors.pop();
      sections.push({
        title: heading.text,
        url: `${page.url}#${encodeURIComponent(heading.id)}`,
        text: "",
        breadcrumbs: ancestors
          .filter(
            (ancestor) =>
              !(
                ancestor.depth === 1 &&
                ancestor.text.normalize("NFKC").toLowerCase() ===
                  page.title.normalize("NFKC").toLowerCase()
              ),
          )
          .map((ancestor) => ancestor.text),
      });
      ancestors.push(heading);
      chunks.push([]);
      return SKIP;
    }
    const text = chunks[chunks.length - 1];
    if (!text) return;
    if (blockTypes.has(node.type) || node.type === "break") text.push(" ");
    if (
      node.type === "text" ||
      node.type === "code" ||
      node.type === "inlineCode"
    )
      text.push(
        node.type === "text"
          ? (node.data?.mddAlertLabel ?? node.value)
          : node.value,
      );
    if ((node.type === "image" || node.type === "imageReference") && node.alt)
      text.push(node.alt);
  });
  if (headingIndex !== page.headings.length) {
    throw new TypeError(
      "Search indexing requires matching compiled Markdown and headings.",
    );
  }
  sections.forEach((entry, index) => {
    entry.text = (chunks[index] ?? []).join("").replace(/\s+/gu, " ").trim();
  });
  return {
    url: page.url,
    title: page.title,
    description: page.description ?? "",
    breadcrumbs,
    sections,
  };
}

/** Build only from successfully compiled pages; no source paths or HTML are indexed. */
export function createSearchIndex(site: Site): SearchIndex {
  const navigation = new Map<string, string[]>();
  const pending = site.navigation.map((item) => ({
    item,
    ancestors: [] as string[],
  }));
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    const { item, ancestors } = entry;
    if (ancestors.length > 64)
      throw new TypeError("Search navigation exceeds 64 ancestor labels.");
    if (item.url) navigation.set(item.url, ancestors);
    for (const child of item.children ?? [])
      pending.push({ item: child, ancestors: [...ancestors, item.title] });
  }
  const index: SearchIndex = {
    version: 1,
    pages: site.pages.map((page) =>
      indexPage(page, navigation.get(page.url) ?? []),
    ),
  };
  index.pages.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  validateSearchIndex(index);
  return index;
}
