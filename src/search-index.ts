import { toString as nodeText } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import {
  type SearchIndex,
  type SearchPage,
  type SearchSection,
  validateSearchIndex,
} from "./search.js";
import type { Page, Site } from "./types.js";

const parser = unified().use(remarkParse).use(remarkGfm);
const blockTypes = new Set(["paragraph", "code", "tableCell", "listItem"]);

function indexPage(page: Page): SearchPage {
  const sections: SearchSection[] = [{ title: "", url: page.url, text: "" }];
  let headingIndex = 0;
  const chunks: string[][] = [[]];
  visit(parser.parse(page.markdown), (node) => {
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
      sections.push({
        title: heading.text,
        url: `${page.url}#${encodeURIComponent(heading.id)}`,
        text: "",
      });
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
      text.push(node.value);
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
    sections,
  };
}

/** Build only from successfully compiled pages; no source paths or HTML are indexed. */
export function createSearchIndex(site: Site): SearchIndex {
  const index: SearchIndex = { version: 1, pages: site.pages.map(indexPage) };
  index.pages.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  validateSearchIndex(index);
  return index;
}
