import type { Root, Text } from "mdast";

declare module "mdast" {
  interface TextData {
    mddAlertMarker?: true;
  }
}

/** Recognize alerts only at the document root, using unescaped source syntax. */
export function transformAlerts(tree: Root, source: string): void {
  for (const node of tree.children) {
    if (node.type !== "blockquote") continue;
    const paragraph = node.children[0];
    const first =
      paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
    const offset = paragraph?.position?.start.offset;
    if (
      paragraph?.type !== "paragraph" ||
      first?.type !== "text" ||
      offset === undefined ||
      paragraph.position?.start.line !== node.position?.start.line
    )
      continue;
    const marker =
      /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][\t ]*(?:\r\n|\r|\n|$)/.exec(
        source.slice(offset),
      );
    const kind = marker?.[1];
    if (!kind) continue;
    first.value = first.value.slice(kind.length + 3);
    const bodyStart = paragraph.children[0];
    if (bodyStart?.type === "text") {
      bodyStart.value = bodyStart.value.replace(/^[\t ]*(?:\r\n|\r|\n)?/, "");
      if (!bodyStart.value) paragraph.children.shift();
    }
    if (paragraph.children[0]?.type === "break") paragraph.children.shift();
    if (!paragraph.children.length) node.children.shift();

    const type = kind.toLowerCase();
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    const markerText: Text = {
      type: "text",
      value: `[!${kind}]`,
      data: { mddAlertMarker: true },
    };
    node.children.unshift({
      type: "paragraph",
      children: [markerText],
      data: {
        hProperties: { className: ["mdd-component-label"] },
        hChildren: [
          {
            type: "element",
            tagName: "strong",
            properties: {},
            children: [{ type: "text", value: label }],
          },
        ],
      },
    });
    node.data = {
      hName: "aside",
      hProperties: { className: ["mdd-alert", `mdd-${type}`] },
    };
  }
}
