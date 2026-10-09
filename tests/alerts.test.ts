import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileProject } from "../src/index.js";
import { parseDocument, renderDocument } from "../src/markdown.js";
import type { Diagnostic } from "../src/types.js";

async function compile(source: string) {
  const diagnostics: Diagnostic[] = [];
  const document = parseDocument(source, "alerts.md", diagnostics);
  return { document, diagnostics, ...(await renderDocument(document)) };
}

describe("GitHub alerts", () => {
  test.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])(
    "%s renders a labeled semantic notice and round-trips its actual marker",
    async (type) => {
      const result = await compile(
        `> [!${type}]\n> Keep **this** information.\n`,
      );
      const name = type.toLowerCase();
      expect(result.diagnostics).toEqual([]);
      expect(result.html).toContain(`<aside class="mdd-alert mdd-${name}">`);
      expect(result.html).toContain(
        `<p class="mdd-component-label"><strong>${name[0]?.toUpperCase()}${name.slice(1)}</strong></p>`,
      );
      expect(result.html).toContain(
        "<p>Keep <strong>this</strong> information.</p>",
      );
      expect(result.markdown).toStartWith(`> [!${type}]\n`);
      expect(result.markdown).not.toContain(`\\[!${type}]`);
      const again = await compile(result.markdown);
      expect(again.diagnostics).toEqual([]);
      expect(again.html).toBe(result.html);
      expect(again.markdown).toBe(result.markdown);
    },
  );

  test("preserves paragraphs, inline formatting, lists, references, code, and headings", async () => {
    const source = [
      "> [!IMPORTANT]",
      "> Read the **bold** and *emphasized* `code`.",
      ">",
      "> Second paragraph with [the guide][guide].",
      ">",
      "> - First item",
      "> - Second item",
      ">",
      "> ```text",
      "> [!CAUTION] is an example, not another alert.",
      "> ```",
      ">",
      "> ## Inside the notice",
      "> Final paragraph.",
      "",
      "[guide]: https://example.com/guide",
    ].join("\n");
    const result = await compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.html.match(/<aside /g)).toHaveLength(1);
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<em>emphasized</em>");
    expect(result.html).toContain("<code>code</code>");
    expect(result.html).toContain(
      '<a href="https://example.com/guide">the guide</a>',
    );
    expect(result.html).toContain("<li>Second item</li>");
    expect(result.html).toContain(
      "[!CAUTION] is an example, not another alert.",
    );
    expect(result.document.headings).toEqual([
      { depth: 2, text: "Inside the notice", id: "mdd-inside-the-notice" },
    ]);
    expect(result.html).toContain('<h2 id="mdd-inside-the-notice">');
    expect(result.markdown).toContain("> Final paragraph.");
    expect((await compile(result.markdown)).html).toBe(result.html);
    const tree = structuredClone(result.document.tree);
    await renderDocument(result.document);
    expect(result.document.tree).toEqual(tree);
  });

  test.each([
    ["CRLF", "> [!NOTE]\r\n> Body.\r\n"],
    ["trailing spaces", "> [!NOTE]  \n> Body.\n"],
    ["trailing tab", "> [!NOTE]\t\n> Body.\n"],
    ["separate body paragraph", "> [!NOTE]\n>\n> Body.\n"],
    ["formatted body first", "> [!NOTE]\n> **Body.**\n"],
  ])(
    "accepts %s without leaking the marker's line break",
    async (_name, source) => {
      const result = await compile(source);
      expect(result.diagnostics).toEqual([]);
      expect(result.html).toContain('<aside class="mdd-alert mdd-note">');
      expect(result.html).toContain("Body.");
      expect(result.html).not.toContain("<br>");
      expect(result.html).not.toContain("[!NOTE]");
      expect((await compile(result.markdown)).html).toBe(result.html);
    },
  );

  test.each([
    ["ordinary quote", "> Ordinary words.\n", "Ordinary words."],
    ["unknown marker", "> [!OTHER]\n> Body.\n", "[!OTHER]"],
    ["lowercase marker", "> [!note]\n> Body.\n", "[!note]"],
    [
      "same-line suffix",
      "> [!NOTE] Custom title\n> Body.\n",
      "[!NOTE] Custom title",
    ],
    ["escaped bracket", "> \\[!NOTE]\n> Body.\n", "[!NOTE]"],
    ["escaped bang", "> [\\!NOTE]\n> Body.\n", "[!NOTE]"],
    ["character reference", "> &#91;!NOTE]\n> Body.\n", "[!NOTE]"],
    ["inline code", "> `[!NOTE]`\n> Body.\n", "<code>[!NOTE]</code>"],
    ["bold marker", "> **[!NOTE]**\n> Body.\n", "[!NOTE]"],
    ["blank opening quote", ">\n> [!NOTE]\n> Body.\n", "[!NOTE]"],
    ["later paragraph", "> Intro.\n>\n> [!NOTE]\n> Body.\n", "[!NOTE]"],
    ["fenced example", "```markdown\n> [!NOTE]\n> Body.\n```\n", "[!NOTE]"],
    ["indented example", "    > [!NOTE]\n    > Body.\n", "[!NOTE]"],
    ["setext h2", "> [!NOTE]\n> ---\n", "[!NOTE]</h2>"],
    ["setext h1", "> [!NOTE]\n> ===\n", "[!NOTE]</h1>"],
  ])("keeps %s ordinary", async (_name, source, content) => {
    const result = await compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).not.toContain("<aside");
    expect(result.html).toContain(content);
  });

  test.each([
    ["blockquote", "> > [!NOTE]\n> > Nested body.\n"],
    ["list", "- > [!NOTE]\n  > Nested body.\n"],
    ["details", ":::details[More]\n> [!NOTE]\n> Nested body.\n:::\n"],
    [
      "footnote",
      "Read this[^one].\n\n[^one]:\n    > [!NOTE]\n    > Nested body.\n",
    ],
  ])("does not introduce alert syntax inside a %s", async (_name, source) => {
    const result = await compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).not.toContain("<aside");
    expect(result.html).toContain("[!NOTE]");
    expect(result.html).toContain("Nested body.");
  });

  test("does not promote nested markers inside a genuine alert", async () => {
    const result = await compile(
      "> [!NOTE]\n> Outer body.\n>\n> > [!WARNING]\n> > Nested body.\n",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.html.match(/<aside /g)).toHaveLength(1);
    expect(result.html).toContain("[!WARNING]");
    expect((await compile(result.markdown)).html).toBe(result.html);
  });

  test.each([
    "> [!NOTE]\n> Body.\n\n[!NOTE]: https://example.com/reference\n",
    "> [!NOTE][target]\n> Body.\n\n[target]: https://example.com/reference\n",
  ])("preserves markers that are actual reference links", async (source) => {
    const result = await compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).not.toContain("<aside");
    expect(result.html).toContain(
      '<a href="https://example.com/reference">!NOTE</a>',
    );
    expect(result.html).toContain("Body.");
    expect((await compile(result.markdown)).html).toBe(result.html);
  });

  test("keeps URL validation for a shortcut reference that resembles an alert marker", async () => {
    const result = await compile(
      "> [!NOTE]\n> Body.\n\n[!NOTE]: javascript:evil\n",
    );
    expect(result.diagnostics).toMatchObject([
      { code: "UNSAFE_URL", file: "alerts.md", line: 4, column: 1 },
    ]);
    expect(result.html).not.toContain("<aside");
    expect(result.html).not.toContain("javascript:");
  });

  test("preserves source-located security diagnostics within real alerts", async () => {
    const result = await compile(
      "> [!WARNING]\n> [bad](javascript:evil)\n>\n> <script>evil()</script>\n",
    );
    expect(result.diagnostics).toMatchObject([
      { code: "UNSAFE_URL", file: "alerts.md", line: 2, column: 3 },
      { code: "RAW_HTML", file: "alerts.md", line: 4, column: 3 },
    ]);
    expect(result.html).toContain('<aside class="mdd-alert mdd-warning">');
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("<script");
    expect(result.markdown).not.toContain("javascript:");
    expect(result.markdown).not.toContain("<script");
  });

  test.each(["note", "tip", "warning"])(
    "rejects the removed %s directive with a source-located migration",
    (type) => {
      const diagnostics: Diagnostic[] = [];
      parseDocument(
        `Intro.\n\n:::${type}[Custom title]\nBody.\n:::\n`,
        "alerts.md",
        diagnostics,
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: "REMOVED_COMPONENT",
        file: "alerts.md",
        line: 3,
        column: 1,
      });
      expect(diagnostics[0]?.message).toContain(`> [!${type.toUpperCase()}]`);
      expect(diagnostics[0]?.message).toContain("custom title as bold text");
    },
  );

  test("retains accessible details alongside alerts", async () => {
    const result = await compile(
      ":::details[More information]\nKeep this body.\n:::\n\n> [!TIP]\n> Helpful body.\n",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain('<details class="mdd-details">');
    expect(result.html).toContain(
      '<summary class="mdd-component-label"><strong>More information</strong></summary>',
    );
    expect(result.html).toContain("Keep this body.");
    expect(result.html).toContain('<aside class="mdd-alert mdd-tip">');
  });

  test("resolves local links, headings, and assets inside alerts through the public compiler", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "mdd-alerts-"));
    const contents = path.join(projectDir, "mdd/contents");
    try {
      await mkdir(contents, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(contents, "index.md"),
          [
            "# Home",
            "",
            "> [!NOTE]",
            "> [Guide](guide.md#install).",
            ">",
            "> ![Logo](logo.png)",
            ">",
            "> ## Alert heading",
            "> Body for readers and agents.",
          ].join("\n"),
        ),
        writeFile(path.join(contents, "guide.md"), "# Guide\n\n## Install\n"),
        writeFile(path.join(contents, "logo.png"), "fixture image"),
      ]);
      const result = await compileProject({
        projectDir,
        basePath: "/repository/docs/",
      });
      expect(result.diagnostics).toEqual([]);
      const page = result.site?.pages.find((item) => item.route === "/");
      expect(page?.html).toContain(
        'href="/repository/docs/guide/#mdd-install"',
      );
      expect(page?.html).toContain('src="/repository/docs/_assets/logo.png"');
      expect(page?.headings).toContainEqual({
        depth: 2,
        text: "Alert heading",
        id: "mdd-alert-heading",
      });
      expect(page?.markdown).toContain("> [!NOTE]\n");
      expect(page?.markdown).toContain("Body for readers and agents.");
      expect(result.site?.assets).toHaveLength(1);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
