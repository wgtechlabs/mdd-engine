import { basename, extname } from "node:path";
import GithubSlugger from "github-slugger";
import type { Nodes, Paragraph, Root } from "mdast";
import { toString as nodeText } from "mdast-util-to-string";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { parseDocument as parseYaml } from "yaml";
import type { Diagnostic, Heading, Metadata } from "./types.js";

export interface ParsedDocument {
  tree: Root;
  metadata: Metadata;
  title: string;
  headings: Heading[];
}

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkDirective);

const htmlRenderer = unified()
  .use(remarkRehype)
  .use(rehypeSanitize, {
    ...defaultSchema,
    // Only generated, mdd-prefixed heading IDs enter the document.
    clobberPrefix: "",
    tagNames: [...(defaultSchema.tagNames ?? []), "aside"],
    attributes: {
      ...defaultSchema.attributes,
      aside: [["className", /^mdd-/]],
      details: [["className", "mdd-details"]],
      p: [
        ...(defaultSchema.attributes?.p ?? []),
        ["className", "mdd-component-label"],
      ],
      summary: [
        ...(defaultSchema.attributes?.summary ?? []),
        ["className", "mdd-component-label"],
      ],
    },
    protocols: {
      ...defaultSchema.protocols,
      href: ["http", "https", "mailto", "tel"],
      src: ["http", "https"],
    },
  })
  .use(rehypeStringify);

const markdownRenderer = unified().use(remarkGfm).use(remarkStringify);
const componentNames = new Set(["note", "tip", "warning", "details"]);

function unsafeUrl(url: string, image: boolean): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject schemes hidden by URL control characters.
  const normalized = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  return Boolean(
    scheme &&
      !(
        image ? ["http", "https"] : ["http", "https", "mailto", "tel"]
      ).includes(scheme),
  );
}

export function parseDocument(
  source: string,
  file: string,
  diagnostics: Diagnostic[],
): ParsedDocument {
  const tree = parser.parse(source);
  const metadata: Metadata = {};
  const headings: Heading[] = [];
  const slugger = new GithubSlugger();
  const imageReferences = new Set<string>();
  visit(tree, "imageReference", (node) => {
    imageReferences.add(node.identifier.toLowerCase());
  });
  const report = (code: string, message: string, node: Nodes) => {
    diagnostics.push({
      severity: "error",
      code,
      message,
      file,
      line: node.position?.start.line,
      column: node.position?.start.column,
    });
  };

  const frontmatter = tree.children[0];
  if (frontmatter?.type === "yaml") {
    try {
      const yaml = parseYaml(frontmatter.value);
      if (yaml.errors.length || yaml.warnings.length) {
        throw new Error(
          [...yaml.errors, ...yaml.warnings]
            .map((error) => error.message)
            .join("; "),
        );
      }
      const value: unknown = yaml.toJS({ maxAliasCount: 0 });
      if (
        (value === null && yaml.contents !== null) ||
        (value !== null && (typeof value !== "object" || Array.isArray(value)))
      ) {
        throw new Error("Frontmatter must be a mapping of metadata fields.");
      }
      for (const [key, entry] of Object.entries(value ?? {})) {
        if (key === "order") {
          if (typeof entry !== "number" || !Number.isFinite(entry)) {
            throw new Error("Frontmatter order must be a finite number.");
          }
          metadata.order = entry;
        } else if (
          key === "title" ||
          key === "description" ||
          key === "navTitle"
        ) {
          if (typeof entry !== "string" || !entry.trim()) {
            throw new Error(`Frontmatter ${key} must be a nonempty string.`);
          }
          metadata[key] = entry.trim();
        } else {
          throw new Error(`Unknown frontmatter field: ${key}.`);
        }
      }
    } catch (error) {
      report(
        "INVALID_FRONTMATTER",
        error instanceof Error ? error.message : "Invalid YAML frontmatter.",
        frontmatter,
      );
    }
    tree.children.shift();
  }

  visit(tree, (node, index, parent) => {
    if (node.type === "html") {
      report(
        "RAW_HTML",
        "Raw HTML is not supported; use Markdown or an mdd component.",
        node,
      );
    }
    if (
      (node.type === "link" ||
        node.type === "image" ||
        node.type === "definition") &&
      unsafeUrl(
        node.url,
        node.type === "image" ||
          (node.type === "definition" &&
            imageReferences.has(node.identifier.toLowerCase())),
      )
    ) {
      report(
        "UNSAFE_URL",
        "Use a relative URL or an allowed HTTP, HTTPS, mailto, or tel URL.",
        node,
      );
      node.url = "";
    }
    if (node.type === "heading") {
      const text = nodeText(node);
      const id = `mdd-${slugger.slug(text)}`;
      node.data = { ...node.data, hProperties: { id } };
      headings.push({ depth: node.depth, text, id });
    }
    if (
      node.type !== "containerDirective" &&
      node.type !== "leafDirective" &&
      node.type !== "textDirective"
    ) {
      return;
    }
    if (node.type !== "containerDirective" || !componentNames.has(node.name)) {
      report(
        "UNKNOWN_COMPONENT",
        `Unsupported component ${node.name}; use a note, tip, warning, or details container.`,
        node,
      );
      return;
    }
    if (Object.keys(node.attributes ?? {}).length) {
      report(
        "INVALID_COMPONENT",
        `The ${node.name} component does not support attributes.`,
        node,
      );
    }
    if (index === undefined || !parent) return;
    const first = node.children[0];
    const defaultLabel = node.name.charAt(0).toUpperCase() + node.name.slice(1);
    const label: Paragraph =
      first?.type === "paragraph" && first.data?.directiveLabel
        ? first
        : {
            type: "paragraph",
            children: [
              {
                type: "text",
                value: defaultLabel,
              },
            ],
          };
    if (label !== first) node.children.unshift(label);
    if (!nodeText(label).trim()) {
      label.children = [{ type: "text", value: defaultLabel }];
    }
    label.children = [{ type: "strong", children: label.children }];
    label.data = {
      hName: node.name === "details" ? "summary" : "p",
      hProperties: { className: ["mdd-component-label"] },
    };
    parent.children[index] = {
      type: "blockquote",
      children: node.children,
      position: node.position,
      data: {
        hName: node.name === "details" ? "details" : "aside",
        hProperties: { className: [`mdd-${node.name}`] },
      },
    };
    // Revisit the replacement so nested content is validated exactly once.
    return [SKIP, index];
  });

  const filename = basename(file, extname(file)).replace(/[-_]+/g, " ");
  const fallbackTitle = filename.charAt(0).toUpperCase() + filename.slice(1);
  return {
    tree,
    metadata,
    title:
      metadata.title ??
      headings.find((heading) => heading.depth === 1)?.text ??
      fallbackTitle,
    headings,
  };
}

export async function renderDocument(
  document: ParsedDocument,
): Promise<{ html: string; markdown: string }> {
  const htmlTree = await htmlRenderer.run(document.tree);
  const markdownTree = structuredClone(document.tree);
  visit(markdownTree, (node, index, parent) => {
    if (
      (node.type === "html" || node.type === "yaml") &&
      parent &&
      index !== undefined
    ) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
  });
  return {
    html: String(htmlRenderer.stringify(htmlTree)),
    markdown: String(markdownRenderer.stringify(markdownTree)),
  };
}
