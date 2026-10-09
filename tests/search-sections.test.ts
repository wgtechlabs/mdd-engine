import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileProject, createSearchIndex } from "../src/index.js";
import {
  type SearchIndex,
  search,
  validateSearchIndex,
} from "../src/search.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(basePath: string) {
  const root = await mkdtemp(join(tmpdir(), "mdd-section-search-"));
  roots.push(root);
  const files = {
    "index.md": "# Home",
    "guides/index.md": "---\nnavTitle: Developer guides\n---\n# Guides",
    "guides/install.md":
      "# Installation\n\nOverview.\n\n## Local setup\n\nInstall alpha.\n\n### Configuration\n\nChoose your theme.\n\n## Remote setup\n\nInstall beta.\n\n## Remote setup\n\nInstall gamma.",
  };
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, "mdd/contents", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const result = await compileProject({ projectDir: root, basePath });
  expect(result.diagnostics).toEqual([]);
  if (!result.site) throw new Error("Expected compiled search site");
  return result.site;
}

function textIndex(text: string, title = "Guide"): SearchIndex {
  return {
    version: 1,
    pages: [
      {
        url: "/",
        title,
        description: "",
        sections: [{ title: "Details", url: "/#mdd-details", text }],
      },
    ],
  };
}

test.each(["/", "/docs/", "/repository/docs/", "/caf%C3%A9/"])(
  "returns separate section destinations and breadcrumbs under %s",
  async (basePath) => {
    const site = await fixture(basePath);
    const index = createSearchIndex(site);
    const before = JSON.stringify(index);
    const hits = search(index, "setup", { mode: "sections" });
    expect(hits.map((hit) => hit.url)).toEqual([
      `${basePath}guides/install/#mdd-local-setup`,
      `${basePath}guides/install/#mdd-remote-setup`,
      `${basePath}guides/install/#mdd-remote-setup-1`,
    ]);
    for (const hit of hits) {
      expect(hit.kind).toBe("section");
      expect(hit.pageUrl).toBe(`${basePath}guides/install/`);
      expect(hit.breadcrumbs).toEqual(["Developer guides", "Installation"]);
      const range = hit.matches.section[0];
      if (!range) throw new Error("Expected heading match");
      expect(hit.section?.slice(...range)).toBe("setup");
    }
    const nested = search(index, "theme", { mode: "sections" })[0];
    expect(nested?.breadcrumbs).toEqual([
      "Developer guides",
      "Installation",
      "Local setup",
    ]);
    expect(nested?.excerpt).toBe("Choose your theme.");
    expect(search(index, "setup")).toHaveLength(1);
    expect(search(index, "alpha beta")).toHaveLength(1);
    expect(search(index, "alpha beta", { mode: "sections" })).toEqual([]);
    expect(
      search(index, "installation theme", { mode: "sections" })[0]?.url,
    ).toBe(nested?.url);
    expect(JSON.stringify(index)).toBe(before);
    expect(search(JSON.parse(before), "setup", { mode: "sections" })).toEqual(
      hits,
    );
  },
);

test("page title hits do not expand into every heading or repeat the title-only H1", async () => {
  const index = createSearchIndex(await fixture("/docs/"));
  const hits = search(index, "installation", { mode: "sections" });
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({
    kind: "page",
    pageUrl: "/docs/guides/install/",
    url: "/docs/guides/install/",
    breadcrumbs: ["Developer guides"],
  });
  expect(hits[0]?.matches.title).toEqual([[0, 12]]);
});

test.each(["brige", "bridgge", "bridxe", "brideg"])(
  "finds a single-edit typo %s and highlights the indexed spelling",
  (query) => {
    const index = textIndex("Execute the bridge safely.");
    expect(search(index, query)).toEqual([]);
    const hit = search(index, query, { mode: "sections", fuzzy: true })[0];
    expect(hit?.url).toBe("/#mdd-details");
    expect(
      hit?.matches.excerpt.map(([start, end]) => hit.excerpt.slice(start, end)),
    ).toEqual(["bridge"]);
  },
);

test("prefers literal matches and bounds typo correction to one eligible term", () => {
  const index = textIndex("Bridge configuration works.");
  expect(
    search(index, "brige configuration", { mode: "sections", fuzzy: true }),
  ).toHaveLength(1);
  expect(
    search(index, "brige configuraton", { mode: "sections", fuzzy: true }),
  ).toEqual([]);
  expect(
    search(textIndex("cat"), "bat", { mode: "sections", fuzzy: true }),
  ).toEqual([]);
  expect(
    search(textIndex("a".repeat(34)), `${"a".repeat(32)}b`, {
      mode: "sections",
      fuzzy: true,
    }),
  ).toEqual([]);
  const exact = {
    description: "",
    url: "/literal/",
    title: "Brige",
    sections: [],
  };
  const ranked = search(
    { version: 1, pages: [...index.pages, exact] },
    "brige",
    { mode: "sections", fuzzy: true },
  );
  expect(ranked[0]?.url).toBe("/literal/");
  expect(ranked[1]?.url).toBe("/#mdd-details");
  expect(search(index, "brid", { mode: "sections" })).toHaveLength(1);
  expect(search(index, "bridge", { mode: "sections", limit: 0 })).toEqual([]);
});

test.each([
  ["ＴＨＥＭＥ", "theme"],
  ["oﬃce", "office"],
  ["Cafe\u0301", "café"],
  ["İstanbul", "i"],
  ["ΟΣ", "ος"],
  ["ㄱㅏ", "가"],
  ["𐐀𐐁", "𐐨𐐩"],
])("returns original grapheme-safe ranges for %s", (original, query) => {
  const hit = search(
    textIndex(
      `${"😀 context ".repeat(40)}Selected ${original} text ${"context ".repeat(40)}`,
    ),
    query,
    { mode: "sections" },
  )[0];
  expect(hit?.excerpt).toContain(original);
  const marked = hit?.matches.excerpt.map(([start, end]) =>
    hit.excerpt.slice(start, end),
  );
  expect(marked).toContain(original === "İstanbul" ? "İ" : original);
  expect(Array.from(hit?.excerpt ?? "").length).toBeLessThanOrEqual(160);
  for (const [start, end] of hit?.matches.excerpt ?? []) {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThanOrEqual(hit?.excerpt.length ?? 0);
    expect(end).toBeGreaterThan(start);
  }
});

test("merges overlapping highlights and preserves literal untrusted text", () => {
  const hit = search(textIndex("<script>alphabet</script>"), "alpha alphabet", {
    mode: "sections",
  })[0];
  expect(hit?.excerpt).toBe("<script>alphabet</script>");
  expect(hit?.matches.excerpt).toEqual([[8, 16]]);
});

test("retains a coherent section correction when the page title suggests another spelling", () => {
  const hits = search(textIndex("Execute the bridge.", "Bride"), "brige", {
    mode: "sections",
    fuzzy: true,
  });
  expect(hits.map((hit) => hit.url)).toEqual(["/", "/#mdd-details"]);
  const section = hits.find((hit) => hit.kind === "section");
  expect(
    section?.matches.excerpt.map(([start, end]) =>
      section.excerpt.slice(start, end),
    ),
  ).toEqual(["bridge"]);
});

test("accepts old version-one indexes but validates new breadcrumb metadata and options", () => {
  const index = textIndex("needle");
  validateSearchIndex(index);
  expect(search(index, "needle", { mode: "sections" })[0]?.breadcrumbs).toEqual(
    ["Guide"],
  );
  for (const breadcrumbs of [null, "bad", [1], [null]]) {
    const invalid = structuredClone(index);
    Object.assign(invalid.pages[0] ?? {}, { breadcrumbs });
    expect(() => validateSearchIndex(invalid)).toThrow(TypeError);
    const sectionInvalid = structuredClone(index);
    Object.assign(sectionInvalid.pages[0]?.sections[0] ?? {}, { breadcrumbs });
    expect(() => validateSearchIndex(sectionInvalid)).toThrow(TypeError);
  }
  // Public runtime callers may deserialize options without TypeScript.
  expect(() =>
    search(index, "needle", JSON.parse('{"mode":"invalid"}')),
  ).toThrow(RangeError);
  expect(() =>
    search(index, "needle", JSON.parse('{"mode":"sections","fuzzy":"yes"}')),
  ).toThrow();
  expect(() => search(index, "needle", { fuzzy: true })).toThrow(RangeError);
});
