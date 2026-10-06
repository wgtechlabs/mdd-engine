import { describe, expect, test } from "bun:test";
import { parseDocument, renderDocument } from "../src/markdown.js";
import type { Diagnostic } from "../src/types.js";

describe("Markdown compilation", () => {
  test("preserves component content in semantic HTML and ordinary Markdown", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      `---
title: Custom title
navTitle: Start
order: 2
---
# Introduction

:::note[Remember]
Read the **guide**.
:::

::::details[More information]
[Read more](./guide.md)

:::tip
Keep it simple.
:::
::::

:::warning
Pay attention.
:::
`,
      "index.md",
      diagnostics,
    );
    const result = await renderDocument(document);
    expect(diagnostics).toEqual([]);
    expect(document.title).toBe("Custom title");
    expect(document.metadata).toEqual({
      title: "Custom title",
      navTitle: "Start",
      order: 2,
    });
    expect(result.html).toContain('<aside class="mdd-note">');
    expect(result.html).toContain('<details class="mdd-details">');
    expect(result.html).toContain(
      '<summary class="mdd-component-label"><strong>More information</strong></summary>',
    );
    expect(result.html).toContain('<aside class="mdd-tip">');
    expect(result.html).toContain('<aside class="mdd-warning">');
    expect(result.markdown).toContain("> **Remember**");
    expect(result.markdown).toContain("[Read more](./guide.md)");
    expect(result.markdown).toContain("Keep it simple.");
    expect(result.markdown).not.toContain(":::");
    expect(result.markdown).not.toContain("navTitle:");
  });

  test("assigns deterministic prefixed IDs including repeated headings", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      "# Install\n\n## Install\n\n## Install-1\n\n## Install\n",
      "get-started.md",
      diagnostics,
    );
    expect(document.title).toBe("Install");
    expect(document.headings.map((heading) => heading.id)).toEqual([
      "mdd-install",
      "mdd-install-1",
      "mdd-install-1-1",
      "mdd-install-2",
    ]);
    const output = await renderDocument(document);
    expect(output.html).toContain('<h1 id="mdd-install">Install</h1>');
    expect(parseDocument("An ordinary page.", "get-started.md", []).title).toBe(
      "Get started",
    );
  });

  test.each([
    ["unknown: value", "Unknown frontmatter field"],
    ["title: [invalid]", "nonempty string"],
    ["title: ''", "nonempty string"],
    ["order: .inf", "finite number"],
    ["order: '1'", "finite number"],
    ["- item", "mapping"],
    ["null", "mapping"],
    ["title: one\ntitle: two", "unique"],
    ["title: &title hello\nnavTitle: *title", "alias"],
  ])("rejects invalid frontmatter: %s", (yaml, message) => {
    const diagnostics: Diagnostic[] = [];
    parseDocument(`---\n${yaml}\n---\n# Valid body`, "page.md", diagnostics);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "INVALID_FRONTMATTER",
      severity: "error",
      file: "page.md",
      line: 1,
      column: 1,
    });
    expect(diagnostics[0]?.message.toLowerCase()).toContain(
      message.toLowerCase(),
    );
  });

  test.each([
    [":::unknown\nBody\n:::", "UNKNOWN_COMPONENT"],
    ["::note[Body]", "UNKNOWN_COMPONENT"],
    [":note[Body]", "UNKNOWN_COMPONENT"],
    [":::note{onclick=alert}\nBody\n:::", "INVALID_COMPONENT"],
    ["<script>alert('no')</script>", "RAW_HTML"],
  ])("reports unsupported content: %s", (source, code) => {
    const diagnostics: Diagnostic[] = [];
    parseDocument(source, "page.md", diagnostics);
    expect(diagnostics[0]).toMatchObject({ code, file: "page.md", line: 1 });
  });

  test("discards raw HTML without losing locations, content, or Markdown spacing", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      `<script>top</script>

Before <b>bold</b> after.

:::note[Remember]
<script>nested</script>

First

<div>removed</div>

Last
:::

<script>end</script>`,
      "page.md",
      diagnostics,
    );
    expect(diagnostics).toEqual(
      [
        [1, 1],
        [3, 8],
        [3, 15],
        [6, 1],
        [10, 1],
        [15, 1],
      ].map(([line, column]) => ({
        severity: "error",
        code: "RAW_HTML",
        message: "Raw HTML is not supported; use Markdown or an mdd component.",
        file: "page.md",
        line,
        column,
      })),
    );
    const before = structuredClone(document.tree);
    expect(await renderDocument(document)).toEqual({
      html: '<p>Before bold after.</p>\n<aside class="mdd-note">\n<p class="mdd-component-label"><strong>Remember</strong></p>\n<p>First</p>\n<p>Last</p>\n</aside>',
      markdown: "Before bold after.\n\n> **Remember**\n>\n> First\n>\n> Last\n",
    });
    expect(document.tree).toEqual(before);
  });

  test("rejects executable URLs in inline, image, and reference links", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      "[bad](javascript:alert%281%29)\n\n![bad](data:image/svg+xml,bad)\n\n[reference][bad]\n\n[bad]: vbscript:alert\n",
      "page.md",
      diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "UNSAFE_URL",
      "UNSAFE_URL",
      "UNSAFE_URL",
    ]);
    const result = await renderDocument(document);
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("vbscript:");
    expect(result.html).not.toContain("data:");
    expect(result.markdown).not.toContain("javascript:");
    expect(result.markdown).not.toContain("vbscript:");
  });

  test("validates and collects headings inside nested components", () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      "::::note\n# Inner\n\n[bad](javascript:alert%281%29)\n\n<script>bad</script>\n\n:::unknown\nBad\n:::\n::::",
      "page.md",
      diagnostics,
    );
    expect(document.headings).toEqual([
      { depth: 1, text: "Inner", id: "mdd-inner" },
    ]);
    expect(diagnostics.map(({ code, line }) => ({ code, line }))).toEqual([
      { code: "UNSAFE_URL", line: 4 },
      { code: "RAW_HTML", line: 6 },
      { code: "UNKNOWN_COMPONENT", line: 8 },
    ]);
  });

  test.each(["mailto:hello@example.com", "tel:+15551234"])(
    "rejects non-image protocols in reference images: %s",
    (url) => {
      const diagnostics: Diagnostic[] = [];
      parseDocument(
        `![Photo][IMAGE]\n\n[image]: ${url}`,
        "page.md",
        diagnostics,
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ code: "UNSAFE_URL", line: 3 });
    },
  );

  test("accepts HTTPS URLs in reference images", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      "![Photo][IMAGE]\n\n[image]: https://example.com/photo.png",
      "page.md",
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect((await renderDocument(document)).html).toContain(
      'src="https://example.com/photo.png"',
    );
  });

  test("keeps a details component accessible when its label is empty", async () => {
    const document = parseDocument(":::details[]\nBody\n:::", "page.md", []);
    const result = await renderDocument(document);
    expect(result.html).toContain(
      '<summary class="mdd-component-label"><strong>Details</strong></summary>',
    );
  });

  test("renders GFM tables and safe rewritten URLs without changing the parsed tree", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      "# Table\n\n| Name | Value |\n| --- | --- |\n| ~~Old~~ | New |\n\n- [x] Done\n\n[Guide](guide.md)\n",
      "page.md",
      diagnostics,
    );
    const last = document.tree.children.at(-1);
    if (last?.type !== "paragraph" || last.children[0]?.type !== "link")
      throw new Error("Missing test link");
    last.children[0].url = "/docs/guide/#mdd-install";
    const before = structuredClone(document.tree);
    const result = await renderDocument(document);
    expect(result.html).toContain("<table>");
    expect(result.html).toContain("<del>Old</del>");
    expect(result.html).toContain('href="/docs/guide/#mdd-install"');
    expect(result.markdown).toContain("/docs/guide/#mdd-install");
    expect(document.tree).toEqual(before);
    expect(diagnostics).toEqual([]);
  });
});
