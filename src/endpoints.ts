import type { Nodes, Paragraph } from "mdast";

const methods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "TRACE",
  "CONNECT",
]);

/** Endpoint signatures are documentation text, never links or executable requests. */
export function endpointParagraph(
  node: Nodes,
  source: string,
  report: (message: string) => void,
): Paragraph | undefined {
  if (node.type !== "leafDirective") {
    report('Use the leaf form ::endpoint{method="GET" path="/example"}.');
    return;
  }
  const offset = node.position?.start.offset;
  if (
    node.children.length ||
    (offset !== undefined && source.startsWith("::endpoint[", offset))
  ) {
    report("The endpoint component does not support a label.");
    return;
  }
  const attributes = node.attributes ?? {};
  if (
    Object.keys(attributes).some((key) => key !== "method" && key !== "path")
  ) {
    report("The endpoint component supports only method and path attributes.");
    return;
  }
  const method = (attributes.method ?? "").toUpperCase();
  if (!methods.has(method)) {
    report(
      "The endpoint method must be GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, TRACE, or CONNECT.",
    );
    return;
  }
  const path = attributes.path ?? "";
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Endpoint text cannot contain invisible controls or whitespace.
    /[\s\u0000-\u001f\u007f-\u009f]/u.test(path)
  ) {
    report(
      "The endpoint path must start with a single / and contain no whitespace or control characters.",
    );
    return;
  }
  return {
    type: "paragraph",
    position: node.position,
    // Tight lists unwrap ordinary paragraphs; retain the signature's block hook.
    data: { hName: "div", hProperties: { className: ["mdd-endpoint"] } },
    children: [
      {
        type: "strong",
        data: {
          hProperties: {
            className: [
              "mdd-endpoint-method",
              `mdd-method-${method.toLowerCase()}`,
            ],
          },
        },
        children: [{ type: "text", value: method }],
      },
      { type: "text", value: " " },
      {
        type: "inlineCode",
        value: path,
        data: { hProperties: { className: ["mdd-endpoint-path"] } },
      },
    ],
  };
}
