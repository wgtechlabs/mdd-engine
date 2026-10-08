import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileProject } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string> = {}): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "mdd-footer-")),
  );
  temporary.push(root);
  for (const [name, text] of Object.entries({
    "mdd/contents/index.md": "# Home",
    ...files,
  })) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return root;
}

const socials =
  ":::socials\n- [GitHub](https://github.com/wgtechlabs)\n- [Community 🌱](https://example.org/community?ref=docs&lang=en#join)\n:::\n";

describe("shared footer", () => {
  test("returns ordered headless links without creating pages, navigation, assets, or article markup", async () => {
    const root = await fixture({
      "mdd/footer.md": socials,
      "mdd/contents/footer.md": "# A real footer article",
    });
    const result = await compileProject({
      projectDir: root,
      basePath: "/repository/docs/",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.site?.footer).toEqual({
      source: "mdd/footer.md",
      socials: [
        { label: "GitHub", url: "https://github.com/wgtechlabs" },
        {
          label: "Community 🌱",
          url: "https://example.org/community?ref=docs&lang=en#join",
        },
      ],
    });
    expect(result.site?.pages.map((page) => page.source)).toEqual([
      "mdd/contents/footer.md",
      "mdd/contents/index.md",
    ]);
    expect(result.site?.navigation).toHaveLength(2);
    expect(result.site?.assets).toEqual([]);
    expect(
      result.site?.pages.every(
        (page) =>
          !page.html.includes("github.com") &&
          !page.markdown.includes("github.com"),
      ),
    ).toBe(true);
    expect(
      await compileProject({ projectDir: root, basePath: "/repository/docs/" }),
    ).toEqual(result);
  });

  test("omits absent and whitespace-only shared footers", async () => {
    const root = await fixture();
    for (const text of [undefined, "\n \t\r\n"]) {
      if (text !== undefined)
        await writeFile(path.join(root, "mdd/footer.md"), text);
      const result = await compileProject({ projectDir: root });
      expect(result.diagnostics).toEqual([]);
      expect(result.site).toBeDefined();
      expect(result.site).not.toHaveProperty("footer");
    }
  });

  test("resolves footer from custom mddDir and excludes only that exact file when contents includes it", async () => {
    const root = await fixture({
      "documentation/config.json": JSON.stringify({
        paths: { contents: ".", themes: "../styles" },
      }),
      "documentation/index.md": "# Home",
      "documentation/footer.md": socials,
      "documentation/guide/footer.md": "# Footer guide",
    });
    const result = await compileProject({
      projectDir: root,
      mddDir: "documentation",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.site?.footer?.source).toBe("documentation/footer.md");
    expect(result.site?.pages.map((page) => page.source)).toEqual([
      "documentation/guide/footer.md",
      "documentation/index.md",
    ]);
  });

  test("supports mddDir at project root", async () => {
    const root = await fixture({
      "contents/index.md": "# Home",
      "footer.md": socials,
    });
    const result = await compileProject({ projectDir: root, mddDir: "." });
    expect(result.diagnostics).toEqual([]);
    expect(result.site?.footer?.source).toBe("footer.md");
  });

  test.each([
    "# Footer\n",
    `---\ntitle: Footer\n---\n${socials}`,
    `${socials}\nUnrelated paragraph.\n`,
    `${socials}\n${socials}`,
    ":::socials{onclick=alert}\n- [GitHub](https://github.com)\n:::",
    ":::socials[Label]\n- [GitHub](https://github.com)\n:::",
    ":::note\n- [GitHub](https://github.com)\n:::",
    ":::socials\n:::",
    ":::socials\n1. [GitHub](https://github.com)\n:::",
    ":::socials\n<script>alert(1)</script>\n:::",
    ":::socials\n- [GitHub](https://github.com) extra\n:::",
    ":::socials\n- [GitHub](https://github.com)\n  - [Nested](https://example.com)\n:::",
    ":::socials\n- [x] [GitHub](https://github.com)\n:::",
    ":::socials\n- ![Image](https://example.com/icon.svg)\n:::",
    ":::socials\n- [**GitHub**](https://github.com)\n:::",
    ":::socials\n- [ ](https://github.com)\n:::",
    ":::socials\n- [GitHub][github]\n:::\n\n[github]: https://github.com\n",
  ])(
    "rejects unsupported footer structure with source locations: %s",
    async (text) => {
      const result = await compileProject({
        projectDir: await fixture({ "mdd/footer.md": text }),
      });
      expect(result.site).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of result.diagnostics) {
        expect(["INVALID_FOOTER", "INVALID_SOCIAL_LINK"]).toContain(
          diagnostic.code,
        );
        expect(diagnostic.file).toBe("mdd/footer.md");
        expect(diagnostic.line).toBeGreaterThan(0);
        expect(diagnostic.column).toBeGreaterThan(0);
      }
    },
  );

  test.each([
    "http://example.com",
    "//example.com",
    "../contents/index.md",
    "#join",
    "javascript:alert(1)",
    "data:text/html,hello",
    "mailto:hello@example.com",
    "https://user:password@example.com",
    "https://user%3Apassword@example.com",
    "https:////example.com",
    "https://",
    "https://example.com/&#x09;tab",
    "https://example.com/\u200bhidden",
    "https://example.com\\@other.example",
  ])("rejects unsafe social URL: %s", async (url) => {
    const result = await compileProject({
      projectDir: await fixture({
        "mdd/footer.md": `:::socials\n- [Community](<${url}>)\n:::`,
      }),
    });
    expect(result.site).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({
      code: "UNSAFE_SOCIAL_URL",
      file: "mdd/footer.md",
      line: 2,
    });
  });

  test("rejects a footer directory and all footer symlinks including broken or escaping targets", async () => {
    const outside = await fixture({ "socials.md": socials });
    for (const target of [
      "contents/index.md",
      "missing.md",
      path.join(outside, "socials.md"),
      ".",
    ]) {
      const root = await fixture();
      await symlink(target, path.join(root, "mdd/footer.md"));
      const result = await compileProject({ projectDir: root });
      expect(result.site).toBeUndefined();
      expect(result.diagnostics[0]?.file).toBe("mdd/footer.md");
      expect([
        "FOOTER_SYMLINK",
        "BROKEN_SYMLINK",
        "PATH_NOT_FOUND",
        "PATH_OUTSIDE_PROJECT",
        "INVALID_FILE_TYPE",
      ]).toContain(result.diagnostics[0]?.code ?? "");
    }
    const root = await fixture();
    await mkdir(path.join(root, "mdd/footer.md"));
    expect(
      (await compileProject({ projectDir: root })).diagnostics[0],
    ).toMatchObject({ code: "INVALID_FILE_TYPE", file: "mdd/footer.md" });
  });

  test("keeps socials out of article authoring syntax", async () => {
    const result = await compileProject({
      projectDir: await fixture({
        "mdd/contents/index.md": `# Home\n\n${socials}`,
      }),
    });
    expect(result.site).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("UNKNOWN_COMPONENT");
  });
});
