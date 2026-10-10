import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, createSearchIndex } from "../src/index.js";
import { parseDocument, renderDocument } from "../src/markdown.js";
import { search } from "../src/search.js";
import type { Diagnostic } from "../src/types.js";

describe("endpoint documentation", () => {
  test.each([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "TRACE",
    "CONNECT",
  ])("normalizes %s and emits semantic, readable content", async (method) => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      `::endpoint{method="${method.toLowerCase()}" path="/v1/widgets/{id}?expand=owner&limit=1"}`,
      "api.md",
      diagnostics,
    );
    const before = structuredClone(document.tree);
    const rendered = await renderDocument(document);
    expect(diagnostics).toEqual([]);
    expect(rendered.html).toBe(
      `<div class="mdd-endpoint"><strong class="mdd-endpoint-method mdd-method-${method.toLowerCase()}">${method}</strong> <code class="mdd-endpoint-path">/v1/widgets/{id}?expand=owner&#x26;limit=1</code></div>`,
    );
    expect(rendered.markdown).toBe(
      `**${method}** \`/v1/widgets/{id}?expand=owner&limit=1\`\n`,
    );
    expect(document.tree).toEqual(before);
  });

  test.each([
    '::endpoint{path="/widgets"}',
    '::endpoint{method="GET"}',
    '::endpoint{method="FETCH" path="/widgets"}',
    '::endpoint{method="GET " path="/widgets"}',
    '::endpoint{method="GET" path=""}',
    '::endpoint{method="GET" path="widgets"}',
    '::endpoint{method="GET" path="https://example.com/widgets"}',
    '::endpoint{method="GET" path="//example.com/widgets"}',
    '::endpoint{method="GET" path="/two words"}',
    '::endpoint{method="GET" path="/two&#9;words"}',
    '::endpoint{method="GET" path="/two\u0085words"}',
    '::endpoint{method="GET" path="/two\u007fwords"}',
    '::endpoint{method="GET" path="/widgets" onclick="alert(1)"}',
    '::endpoint{method="GET" path="/widgets" .custom}',
    '::endpoint[Title]{method="GET" path="/widgets"}',
    '::endpoint[]{method="GET" path="/widgets"}',
    ':endpoint{method="GET" path="/widgets"}',
    ':::endpoint{method="GET" path="/widgets"}\nBody\n:::',
  ])("rejects invalid signature with a source location: %s", (source) => {
    const diagnostics: Diagnostic[] = [];
    parseDocument(`# API\n\n${source}`, "api.md", diagnostics);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "INVALID_COMPONENT",
      severity: "error",
      file: "api.md",
      line: 3,
      column: 1,
    });
  });

  test("escapes markup-looking paths and preserves code language classes", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      '::endpoint{method="GET" path="/v1/<script>alert(1)</script>?id={id}"}\n\n```js\nconst html = "<script>";\n```',
      "api.md",
      diagnostics,
    );
    const output = await renderDocument(document);
    expect(diagnostics).toEqual([]);
    expect(output.html).toContain(
      "/v1/&#x3C;script>alert(1)&#x3C;/script>?id={id}</code>",
    );
    expect(output.html).toContain('<code class="language-js">');
    expect(output.html).not.toContain("<script>");
    expect(output.html).not.toContain("href=");
    expect(output.markdown).toContain(
      "`/v1/<script>alert(1)</script>?id={id}`",
    );
  });

  test("works inside details without losing heading collection or nested validation", async () => {
    const diagnostics: Diagnostic[] = [];
    const document = parseDocument(
      ':::details[API reference]\n## Retrieve\n\n::endpoint{method="GET" path="/widgets"}\n:::',
      "api.md",
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(document.headings).toEqual([
      { depth: 2, text: "Retrieve", id: "mdd-retrieve" },
    ]);
    const result = await renderDocument(document);
    expect(result.html).toContain('<div class="mdd-endpoint">');
    expect(result.markdown).toContain("> **GET** `/widgets`");
    const invalid: Diagnostic[] = [];
    parseDocument(
      ':::details\n::endpoint{method="GET" path="//example.com"}\n:::',
      "api.md",
      invalid,
    );
    expect(invalid).toMatchObject([{ code: "INVALID_COMPONENT", line: 2 }]);
  });

  test.each([
    ["tight list", "- ", "* **GET** `/v1`\n"],
    ["blockquote", "> ", "> **GET** `/v1`\n"],
  ])(
    "preserves its semantic wrapper inside a %s",
    async (_name, prefix, markdown) => {
      const diagnostics: Diagnostic[] = [];
      const document = parseDocument(
        `${prefix}::endpoint{method="GET" path="/v1"}`,
        "api.md",
        diagnostics,
      );
      const rendered = await renderDocument(document);
      expect(diagnostics).toEqual([]);
      expect(rendered.html).toContain(
        '<div class="mdd-endpoint"><strong class="mdd-endpoint-method mdd-method-get">GET</strong> <code class="mdd-endpoint-path">/v1</code></div>',
      );
      expect(rendered.markdown).toBe(markdown);
    },
  );

  test("compiles literal endpoint paths, indexes their text, and rejects invalid projects", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "mdd-endpoint-"));
    const contents = join(projectDir, "mdd", "contents");
    try {
      await mkdir(contents, { recursive: true });
      await writeFile(
        join(contents, "index.md"),
        '# API\n\n## Retrieve\n\n::endpoint{method="GET" path="/v1/widgets/{id}"}\n\n| Name | Type |\n| --- | --- |\n| `id` | string |\n',
      );
      for (const basePath of ["/", "/docs/", "/repository/docs/"]) {
        const result = await compileProject({ projectDir, basePath });
        expect(result.diagnostics).toEqual([]);
        if (!result.site) throw new Error("Expected compiled endpoint fixture");
        const page = result.site.pages[0];
        expect(page?.html).toContain(
          'class="mdd-endpoint-path">/v1/widgets/{id}</code>',
        );
        expect(page?.html).toContain("<table>");
        const index = createSearchIndex(result.site);
        expect(search(index, "GET widgets")[0]).toMatchObject({
          url: `${basePath}#mdd-retrieve`,
        });
        expect(index.pages[0]?.sections[2]?.text).toBe(
          "GET /v1/widgets/{id} Name Type id string",
        );
      }
      await writeFile(
        join(contents, "index.md"),
        '::endpoint{method="GET" path="javascript:alert(1)"}',
      );
      const result = await compileProject({ projectDir });
      expect(result.site).toBeUndefined();
      expect(result.diagnostics).toMatchObject([
        { code: "INVALID_COMPONENT", file: "mdd/contents/index.md", line: 1 },
      ]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
