import type { Nodes } from "mdast";
import { parseMarkdown } from "./markdown.js";
import type { Diagnostic, Footer, SocialLink } from "./types.js";

function socialUrl(value: string): string | undefined {
  // Reject URL normalization that could hide a scheme, credentials, or controls.
  if (!/^https:\/\/[^/?#]/i.test(value) || /[\s\\\p{Cc}\p{Cf}]/u.test(value))
    return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** The shared footer is data, never an article or executable author markup. */
export function parseFooter(
  source: string,
  file: string,
  diagnostics: Diagnostic[],
): Footer | undefined {
  if (!source.trim()) return undefined;
  const tree = parseMarkdown(source);
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
  const component = tree.children[0];
  if (
    tree.children.length !== 1 ||
    component?.type !== "containerDirective" ||
    component.name !== "socials" ||
    Object.keys(component.attributes ?? {}).length
  ) {
    report(
      "INVALID_FOOTER",
      "Use a single :::socials block without attributes in footer.md.",
      component ?? tree,
    );
    return undefined;
  }
  const list = component.children[0];
  if (
    component.children.length !== 1 ||
    list?.type !== "list" ||
    list.ordered ||
    !list.children.length
  ) {
    report(
      "INVALID_FOOTER",
      "The socials block must contain an unordered list of labeled Markdown links.",
      list ?? component,
    );
    return undefined;
  }
  const socials: SocialLink[] = [];
  for (const item of list.children) {
    const paragraph = item.children[0];
    const link =
      paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
    if (
      item.children.length !== 1 ||
      item.checked != null ||
      paragraph?.type !== "paragraph" ||
      paragraph.children.length !== 1 ||
      link?.type !== "link" ||
      !link.children.length ||
      link.children.some((child) => child.type !== "text")
    ) {
      report(
        "INVALID_SOCIAL_LINK",
        "Each item must be one Markdown link with a plain text label, without tasks or nested content.",
        item,
      );
      continue;
    }
    const label = link.children
      .map((child) => (child.type === "text" ? child.value : ""))
      .join("")
      .trim();
    if (!label) {
      report(
        "INVALID_SOCIAL_LINK",
        "Social links need a nonempty label.",
        link,
      );
      continue;
    }
    const url = socialUrl(link.url);
    if (!url) {
      report(
        "UNSAFE_SOCIAL_URL",
        "Social links must use absolute HTTPS URLs without credentials, whitespace, controls, or backslashes.",
        link,
      );
      continue;
    }
    socials.push({ label, url });
  }
  return socials.length === list.children.length
    ? { source: file, socials }
    : undefined;
}
