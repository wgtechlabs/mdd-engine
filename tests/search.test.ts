import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileProject } from "../src/index.js";
import {
  type SearchIndex,
  search,
  validateSearchIndex,
} from "../src/search.js";
import { createSearchIndex } from "../src/search-index.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function compile(files: Record<string, string>, basePath = "/") {
  const projectDir = await mkdtemp(join(tmpdir(), "mdd-search-"));
  temporary.push(projectDir);
  for (const [file, text] of Object.entries(files)) {
    const path = join(projectDir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const result = await compileProject({ projectDir, basePath });
  expect(result.diagnostics).toEqual([]);
  if (!result.site) throw new Error("Expected compiled search fixture.");
  return result.site;
}

describe("headless search", () => {
  test("indexes only compiled readable page content, round trips JSON, and does not mutate its input", async () => {
    const site = await compile({
      "mdd/contents/index.md": `---
title: Reader guide
description: API reference
navTitle: Navigation secret
---
# Welcome
Read **important** [linked words](https://example.test/hidden-url).

:::note[Careful]
A helpful component.
:::

| Column | Other |
| --- | --- |
| cell | entry |

\`\`\`js
const answer = 42;
\`\`\`
`,
      "mdd/themes/unused/theme.css": "private-theme-secret",
      "private.md": "not-discovered-secret",
    });
    const before = JSON.stringify(site);
    const index = createSearchIndex(site);
    expect(JSON.stringify(site)).toBe(before);
    expect(createSearchIndex(site)).toEqual(index);
    expect(JSON.parse(JSON.stringify(index))).toEqual(index);
    for (const term of [
      "reader",
      "reference",
      "important",
      "linked words",
      "careful",
      "helpful",
      "cell entry",
      "const answer",
    ]) {
      expect(search(index, term).length).toBe(1);
      expect(search(JSON.parse(JSON.stringify(index)), term)).toEqual(
        search(index, term),
      );
    }
    for (const term of [
      "hidden-url",
      "navigation secret",
      "private-theme-secret",
      "not-discovered-secret",
    ]) {
      expect(search(index, term)).toEqual([]);
    }
    expect(index.pages[0]?.sections[1]?.text).toContain(
      "Column Other cell entry",
    );
    expect(index.pages[0]?.sections[1]?.text).not.toContain("**");
  });

  test("uses exact compiled duplicate and Unicode heading IDs at every base path", async () => {
    for (const basePath of [
      "/",
      "/docs/",
      "/repository/docs/",
      "/caf%C3%A9/",
    ]) {
      const site = await compile(
        {
          "mdd/contents/index.md": "# Home",
          "mdd/contents/API café.md":
            "# API\n\n## Déjà vu\n\nFirst body.\n\n## Déjà vu\n\nUnique needle.\n\n## 日本語\n\n別の本文。",
        },
        basePath,
      );
      const page = site.pages.find((page) => page.title === "API");
      if (!page) throw new Error("Expected API page.");
      const index = createSearchIndex(site);
      const hit = search(index, "unique needle")[0];
      expect(hit).toMatchObject({
        title: "API",
        url: `${page.url}#${encodeURIComponent(page.headings[2]?.id ?? "")}`,
        section: "Déjà vu",
        excerpt: "Unique needle.",
      });
      const fragment = decodeURIComponent(
        new URL(hit?.url ?? "", "https://example.test").hash.slice(1),
      );
      expect(page.html).toContain(`id="${fragment}"`);
      expect(search(index, "日本語")[0]?.url).toBe(
        `${page.url}#${encodeURIComponent(page.headings[3]?.id ?? "")}`,
      );
      expect(search(index, "API")[0]?.url).toBe(page.url);
      expect(search(index, "API unique needle")[0]?.url).toBe(hit?.url);
    }
  });

  test("case and Unicode compatibility normalize without dropping accents or requiring a locale", async () => {
    const site = await compile({
      "mdd/contents/index.md":
        "# Café\n\nＦｕｌｌｗｉｄｔｈ words and 日本語の本文。",
    });
    const index = createSearchIndex(site);
    expect(search(index, "CAFE\u0301")).toHaveLength(1);
    expect(search(index, "cafe")).toEqual([]);
    expect(search(index, "fullwidth")).toHaveLength(1);
    expect(search(index, "日本語")).toHaveLength(1);
    expect(search(index, "WORDS words")).toEqual(search(index, "words"));
    expect(search(index, "café café")).toEqual(search(index, "café"));
  });

  test("ranks exact titles before headings, descriptions and body with deterministic ties", async () => {
    const site = await compile({
      "mdd/contents/index.md": "# Install",
      "mdd/contents/heading.md": "# Guide\n\n## Install\n\nUse the command.",
      "mdd/contents/description.md":
        "---\ndescription: Install the app\n---\n# Metadata",
      "mdd/contents/b.md": "# Beta\n\nYou can install here.",
      "mdd/contents/a.md": "# Alpha\n\nYou can install here.",
    });
    const index = createSearchIndex(site);
    expect(search(index, "install").map((hit) => hit.url)).toEqual([
      "/",
      "/heading/#mdd-install",
      "/description/",
      "/a/#mdd-alpha",
      "/b/#mdd-beta",
    ]);
    expect(
      createSearchIndex({ ...site, pages: [...site.pages].reverse() }),
    ).toEqual(index);
    expect(search(index, "install", { limit: 2 })).toHaveLength(2);
    expect(search(index, "install", { limit: 0 })).toEqual([]);
    expect(search(index, "install absent")).toEqual([]);
  });

  test("deduplicates page hits and sends cross-section matches to the page", async () => {
    const site = await compile({
      "mdd/contents/index.md":
        "# Setup\n\n## First\n\nInstall alpha.\n\n## Second\n\nInstall beta.",
    });
    const index = createSearchIndex(site);
    expect(search(index, "install")).toHaveLength(1);
    expect(search(index, "install")[0]?.url).toBe("/#mdd-first");
    expect(search(index, "alpha beta")[0]?.url).toBe("/");
    expect(search(index, "  ")).toEqual([]);
    expect(search(index, "?!")).toEqual([]);
    expect(search(index, "unmatched")).toEqual([]);
    expect(search({ version: 1, pages: [] }, "install")).toEqual([]);
  });

  test("extracts image alt, inline text and hard breaks; excludes reference URLs", async () => {
    const site = await compile({
      "mdd/contents/index.md":
        "Text **with** *formatting* and `code`.\n\nHard  \nbreak.\n\n![Remote image](https://example.test/image.png)\n\n[visible label][reference]\n\n[reference]: https://example.test/hidden-target",
    });
    const index = createSearchIndex(site);
    const text = index.pages[0]?.sections[0]?.text;
    expect(text).toBe(
      "Text with formatting and code. Hard break. Remote image visible label",
    );
    expect(search(index, "hard break")[0]?.url).toBe("/");
    expect(search(index, "hidden target")).toEqual([]);
  });

  test("bounds plain-text excerpts by Unicode code points", async () => {
    const site = await compile({
      "mdd/contents/index.md": `# Page\n\n${"😀".repeat(180)} searchable`,
    });
    const result = search(createSearchIndex(site), "searchable")[0];
    expect(Array.from(result?.excerpt ?? "")).toHaveLength(160);
    expect(result?.excerpt.endsWith("…")).toBe(true);
    expect(result?.excerpt).not.toContain("\uFFFD");
  });

  test("rejects malformed and executable URLs in serialized indexes", () => {
    const valid: SearchIndex = {
      version: 1,
      pages: [
        {
          title: "Title",
          description: "",
          url: "/docs/",
          sections: [
            { title: "Heading", text: "needle", url: "/docs/#mdd-heading" },
          ],
        },
      ],
    };
    const validPage = valid.pages[0];
    if (!validPage) throw new Error("Expected a search page.");
    for (const url of [
      "javascript:alert(1)",
      "https://evil.test/",
      "//evil.test/",
      "/\\evil.test/",
      "/x/../",
      "/%2e%2e/",
      "/%2f%2fevil.test/",
      "/%0aevil/",
      "/docs/?x=1",
      "/docs/#x",
      "/docs/%oops/",
    ]) {
      expect(() =>
        search({ ...valid, pages: [{ ...validPage, url }] }, "needle"),
      ).toThrow();
    }
    for (const url of [
      "javascript:alert(1)",
      "/other/#mdd-heading",
      "/docs/#heading",
      "/docs/#mdd-%ZZ",
      "/docs/#mdd-heading#second",
      "/docs/#mdd-%00",
    ]) {
      const invalid = structuredClone(valid);
      const section = invalid.pages[0]?.sections[0];
      if (!section) throw new Error("Expected a search section.");
      section.url = url;
      expect(() => search(invalid, "needle")).toThrow();
    }
    for (const malformed of [
      null,
      {},
      { version: 2, pages: [] },
      { version: 1, pages: [null] },
      { version: 1, pages: [valid.pages[0], valid.pages[0]] },
    ]) {
      expect(() => validateSearchIndex(malformed)).toThrow();
    }
    validateSearchIndex(valid);
    expect(search(valid, "needle")).toHaveLength(1);
  });

  test("rejects invalid limits and excessive queries", () => {
    const index: SearchIndex = { version: 1, pages: [] };
    for (const limit of [-1, 101, NaN, Infinity, 1.5]) {
      expect(() => search(index, "query", { limit })).toThrow(RangeError);
    }
    expect(() => search(index, "x".repeat(513))).toThrow(RangeError);
    expect(() =>
      search(index, Array.from({ length: 33 }, (_, n) => `word${n}`).join(" ")),
    ).toThrow(RangeError);
  });

  test("does not invent section URLs when supplied models disagree", async () => {
    const site = await compile({ "mdd/contents/index.md": "# Valid\n\nText." });
    const heading = site.pages[0]?.headings[0];
    if (!heading) throw new Error("Expected a compiled heading.");
    heading.text = "Different";
    expect(() => createSearchIndex(site)).toThrow(
      "matching compiled Markdown and headings",
    );
  });
});
