import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileProject } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdd-compile-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, "mdd", file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  return root;
}

describe("compileProject", () => {
  test("separates filesystem asset destinations from encoded public URLs", async () => {
    const projectDir = await fixture({
      "contents/index.md": "# Home\n\n![Café](<assets/café logo.png>)",
      "contents/assets/café logo.png": "image",
    });
    const { site, diagnostics } = await compileProject({
      projectDir,
      basePath: "/docs/",
    });
    expect(diagnostics).toEqual([]);
    expect(site?.assets[0]).toEqual({
      source: "mdd/contents/assets/café logo.png",
      destination: "_assets/assets/café logo.png",
      url: "/docs/_assets/assets/caf%C3%A9%20logo.png",
    });
    const asset = site?.assets[0];
    if (!asset) throw new Error("Expected the referenced asset");
    expect(decodeURIComponent(asset.url.slice("/docs/".length))).toBe(
      asset.destination,
    );
  });
  test("uses uppercase Markdown extensions consistently in folder landing pages", async () => {
    const projectDir = await fixture({
      "contents/index.md": "# Home",
      "contents/guide/index.MD": "# Guide landing",
      "contents/guide/child.md": "# Child",
    });
    const { site, diagnostics } = await compileProject({ projectDir });
    expect(diagnostics).toEqual([]);
    const group = site?.navigation.find(
      (item) => item.title === "Guide landing",
    );
    expect(group?.route).toBe("/guide/");
    expect(group?.children?.map((item) => item.title)).toEqual(["Child"]);
  });
  test("keeps a root home separate from an index-named folder", async () => {
    const projectDir = await fixture({
      "contents/index.md": "# Home",
      "contents/index/child.md": "# Child",
    });
    const { site, diagnostics } = await compileProject({ projectDir });
    expect(diagnostics).toEqual([]);
    expect(site?.navigation).toHaveLength(2);
    expect(
      site?.navigation.find((item) => item.title === "Home")?.children,
    ).toBeUndefined();
    expect(
      site?.navigation.find((item) => item.title === "Index")?.children?.[0]
        ?.title,
    ).toBe("Child");
  });

  test("resolves dotted page routes before asset classification", async () => {
    const projectDir = await fixture({
      "contents/index.md": "# Home\n\n[Version](/v1.0/)",
      "contents/v1.0.md": "# Version",
    });
    const { site, diagnostics } = await compileProject({ projectDir });
    expect(diagnostics).toEqual([]);
    expect(site?.pages[0]?.html).toContain('href="/v1.0/"');
  });

  for (const url of [
    "guide.md",
    "manual.pdf",
    "example.txt",
    "mailto:example@example.com",
  ]) {
    test(`rejects a non-image reference target ${url}`, async () => {
      const projectDir = await fixture({
        "contents/index.md": `# Home\n\n![Image][target]\n\n[target]: ${url}`,
        "contents/guide.md": "# Guide",
        "contents/manual.pdf": "pdf",
        "contents/example.txt": "text",
      });
      const result = await compileProject({ projectDir });
      expect(result.site).toBeUndefined();
      expect(
        result.diagnostics.some(
          (item) => item.code === "INVALID_IMAGE" || item.code === "UNSAFE_URL",
        ),
      ).toBe(true);
    });
  }

  for (const route of ["markdown", "mdd-build.json"]) {
    test(`reserves the website output path ${route}`, async () => {
      const projectDir = await fixture({
        "contents/index.md": "# Home",
        [`contents/${route}.md`]: "# Reserved",
      });
      const result = await compileProject({ projectDir });
      expect(result.site).toBeUndefined();
      expect(
        result.diagnostics.some((item) => item.code === "RESERVED_ROUTE"),
      ).toBe(true);
    });
  }
  for (const basePath of ["/", "/docs/", "/repository/docs/"]) {
    test(`compiles a deterministic headless site at ${basePath}`, async () => {
      const projectDir = await fixture({
        "contents/index.md":
          "# Home\n\n[Install](guide/install.md#install)\n\n[Root](/guide/)\n\n![Logo](assets/logo.png)\n\n:::tip[Start here]\nUse Markdown.\n:::\n",
        "contents/guide/index.md":
          "---\nnavTitle: Getting started\norder: -1\n---\n# Guide\n",
        "contents/guide/install.md":
          "# Install\n\n[Home](../index.md)\n\n## Install\n\n[Duplicate](#install-1)\n",
        "contents/faq/answers.md": "# Answers\n",
        "contents/assets/logo.png": "fixture-image",
        "contents/unused.txt": "must not be published",
      });
      const result = await compileProject({ projectDir, basePath });
      expect(result.diagnostics).toEqual([]);
      expect(result.site).toBeDefined();
      const site = result.site;
      if (!site) throw new Error("Expected a compiled site");
      expect(site.title).toBe("Home");
      expect(site.pages).toHaveLength(4);
      const home = site.pages.find((page) => page.route === "/");
      expect(home?.html).toContain(
        `href="${basePath}guide/install/#mdd-install"`,
      );
      expect(home?.html).toContain(`src="${basePath}_assets/assets/logo.png"`);
      expect(home?.markdown).toContain("Start here");
      expect(home?.markdown).not.toContain(":::tip");
      expect(
        site.pages.find((page) => page.route.endsWith("install/"))?.html,
      ).toContain("#mdd-install-1");
      expect(site.navigation[0]?.title).toBe("Getting started");
      expect(
        site.navigation.find((item) => item.title === "Faq")?.url,
      ).toBeUndefined();
      expect(site.assets).toEqual([
        {
          source: "mdd/contents/assets/logo.png",
          destination: "_assets/assets/logo.png",
          url: `${basePath}_assets/assets/logo.png`,
        },
      ]);
      expect(await compileProject({ projectDir, basePath })).toEqual(result);
    });
  }

  test("preserves filename stems and URL-encodes spaces and Unicode", async () => {
    const projectDir = await fixture({
      "contents/index.md": "# Home\n\n[Page](<get_started/café guide.md>)",
      "contents/get_started/café guide.md": "# Café",
    });
    const { site, diagnostics } = await compileProject({
      projectDir,
      basePath: "docs",
    });
    expect(diagnostics).toEqual([]);
    expect(site?.pages.find((page) => page.title === "Café")?.url).toBe(
      "/docs/get_started/caf%C3%A9%20guide/",
    );
  });

  test("resolves references, route URLs, queries, and fragments", async () => {
    const projectDir = await fixture({
      "contents/index.md":
        "# Home\n\n[Go][guide]\n\n[guide]: /guide/?mode=short#one\n\n![Photo][photo]\n\n[photo]: assets/pic.png\n",
      "contents/guide/index.md": "# One",
      "contents/assets/pic.png": "image",
    });
    const { site, diagnostics } = await compileProject({
      projectDir,
      basePath: "/docs/",
    });
    expect(diagnostics).toEqual([]);
    expect(site?.pages.find((page) => page.route === "/")?.html).toContain(
      "/docs/guide/?mode=short#mdd-one",
    );
    expect(site?.assets).toHaveLength(1);
  });

  for (const [label, files, code] of [
    [
      "route aliases",
      {
        "contents/index.md": "# Home",
        "contents/guide.md": "# Guide",
        "contents/guide/index.md": "# Guide",
      },
      "ROUTE_COLLISION",
    ],
    [
      "reserved routes",
      { "contents/index.md": "# Home", "contents/_mdd/index.md": "# Reserved" },
      "RESERVED_ROUTE",
    ],
    [
      "missing links",
      { "contents/index.md": "# Home\n\n[Missing](missing.md)" },
      "MISSING_LINK",
    ],
    [
      "missing anchors",
      { "contents/index.md": "# Home\n\n[Missing](#nope)" },
      "MISSING_ANCHOR",
    ],
    [
      "missing assets",
      { "contents/index.md": "# Home\n\n![Missing](missing.png)" },
      "MISSING_ASSET",
    ],
    [
      "escaping links",
      { "contents/index.md": "# Home\n\n[Escape](../../README.md)" },
      "PATH_ESCAPE",
    ],
    [
      "active assets",
      {
        "contents/index.md": "# Home\n\n[Script](script.js)",
        "contents/script.js": "alert(1)",
      },
      "UNSUPPORTED_ASSET",
    ],
    [
      "bad URL encoding",
      { "contents/index.md": "# Home\n\n[Bad](bad%ZZ.md)" },
      "INVALID_LINK",
    ],
  ] as const) {
    test(`fails atomically on ${label}`, async () => {
      const projectDir = await fixture(files);
      const result = await compileProject({ projectDir });
      expect(result.site).toBeUndefined();
      expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
      expect(
        result.diagnostics.find((item) => item.code === code)?.file,
      ).toMatch(/^mdd\/contents\//);
    });
  }

  for (const basePath of [
    "https://example.com",
    "//host/",
    "/../docs/",
    "/%2e%2e/docs/",
    "/%2Fdocs/",
    "/docs?x=1",
    "/docs\\oops",
  ]) {
    test(`rejects invalid base path ${basePath}`, async () => {
      const result = await compileProject({
        projectDir: "/not-read",
        basePath,
      });
      expect(result.site).toBeUndefined();
      expect(result.diagnostics[0]?.code).toBe("INVALID_BASE_PATH");
    });
  }
});
