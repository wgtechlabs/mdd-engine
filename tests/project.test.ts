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
import {
  AuthoringError,
  loadProject,
  relativeSource,
  safeFile,
} from "../src/project.js";
import type { Diagnostic } from "../src/types.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  files: Record<string, string> = { "mdd/contents/index.md": "# Home" },
): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "mdd-project-")),
  );
  temporary.push(root);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

async function configured(
  config: unknown,
  extra: Record<string, string> = {},
): Promise<string> {
  return fixture({
    "mdd/contents/index.md": "# Home",
    "mdd/config.json": JSON.stringify(config),
    ...extra,
  });
}

async function load(root: string) {
  const diagnostics: Diagnostic[] = [];
  const project = await loadProject({ projectDir: root }, diagnostics);
  return { project, diagnostics };
}

describe("project discovery", () => {
  test("defaults need no config or theme folder and discover only sorted content Markdown", async () => {
    const root = await fixture({
      "mdd/contents/index.md": "# Home",
      "mdd/contents/z.md": "# Last",
      "mdd/contents/a/start.md": "# Start",
      "mdd/contents/assets/logo.png": "image",
      "mdd/contents/.hidden/secret.md": "hidden",
      "mdd/contents/secrets.md": "sensitive",
      "mdd/contents/node_modules/package/readme.md": "dependency",
      "README.md": "outside selected contents",
    });
    const { project, diagnostics } = await load(root);
    expect(diagnostics).toEqual([]);
    expect(project?.theme).toEqual({ name: "default" });
    expect(project?.files.map((file) => relativeSource(root, file))).toEqual([
      "mdd/contents/a/start.md",
      "mdd/contents/index.md",
      "mdd/contents/z.md",
    ]);
  });

  test("supports sibling content/theme roots and custom mddDir", async () => {
    const root = await fixture({
      "documentation/config.json": JSON.stringify({
        title: "Example",
        paths: { contents: "../pages", themes: "../styles" },
        theme: "custom",
      }),
      "pages/index.md": "# Home",
      "styles/custom/theme.css": "body {}",
      "styles/custom/theme.js": "throw new Error('must never execute')",
    });
    const diagnostics: Diagnostic[] = [];
    const project = await loadProject(
      { projectDir: root, mddDir: "documentation" },
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(project?.contentsRoot).toBe(path.join(root, "pages"));
    expect(project?.title).toBe("Example");
    expect(project?.theme).toEqual({
      name: "custom",
      directory: "styles/custom",
      css: "styles/custom/theme.css",
      js: "styles/custom/theme.js",
    });
  });

  test("supports configuration at the checkout root without scanning the checkout", async () => {
    const root = await fixture({
      "contents/index.md": "# Home",
      "README.md": "outside contents",
    });
    const diagnostics: Diagnostic[] = [];
    const project = await loadProject(
      { projectDir: root, mddDir: "." },
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(project?.files).toEqual([path.join(root, "contents/index.md")]);
  });

  test.each([
    [{ plugins: [] }, "UNKNOWN_CONFIG_FIELD"],
    [{ paths: { content: "contents" } }, "UNKNOWN_CONFIG_FIELD"],
    [{ paths: { contents: null } }, "INVALID_CONFIG"],
    [{ paths: { themes: null } }, "INVALID_CONFIG"],
    [{ theme: null }, "INVALID_CONFIG"],
    [{ paths: [] }, "INVALID_CONFIG"],
    [{ title: "" }, "INVALID_CONFIG"],
    [{ theme: "../custom" }, "INVALID_THEME"],
    [{ paths: { contents: "/tmp" } }, "INVALID_CONFIG_PATH"],
    [{ paths: { contents: "C:\\docs" } }, "INVALID_CONFIG_PATH"],
  ])("rejects invalid config %j", async (config, code) => {
    const { project, diagnostics } = await load(await configured(config));
    expect(project).toBeUndefined();
    expect(diagnostics[0]?.code).toBe(code);
    expect(diagnostics[0]?.file).toBe("mdd/config.json");
  });

  test("reports invalid JSON and a missing homepage", async () => {
    const malformed = await configured({}, { "mdd/config.json": "{" });
    expect((await load(malformed)).diagnostics[0]?.code).toBe(
      "INVALID_CONFIG_JSON",
    );
    const missingHome = await fixture({ "mdd/contents/start.md": "# Start" });
    const result = await load(missingHome);
    expect(result.project).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("MISSING_HOME");
  });

  test.each(["contents", "contents/styles", "."])(
    "rejects overlapping content/theme roots: %s",
    async (themes) => {
      const result = await load(await configured({ paths: { themes } }));
      expect(result.project).toBeUndefined();
      expect(result.diagnostics[0]?.code).toBe("OVERLAPPING_ROOTS");
    },
  );

  test("rejects traversal, whole-checkout discovery, and an escaping content symlink", async () => {
    const outside = await fixture({ "index.md": "# Outside" });
    const traversal = await configured({
      paths: { contents: "../../outside" },
    });
    expect((await load(traversal)).diagnostics[0]?.code).toBe(
      "PATH_OUTSIDE_PROJECT",
    );
    const wholeProject = await configured({ paths: { contents: ".." } });
    expect((await load(wholeProject)).diagnostics[0]?.code).toBe(
      "INVALID_CONTENT_ROOT",
    );
    const linked = await configured({ paths: { contents: "linked" } });
    await symlink(outside, path.join(linked, "mdd/linked"));
    expect((await load(linked)).diagnostics[0]?.code).toBe(
      "PATH_OUTSIDE_PROJECT",
    );
  });

  test("rejects discovered symlinks including cycles and file aliases", async () => {
    for (const target of [".", "index.md"]) {
      const root = await fixture();
      await symlink(target, path.join(root, "mdd/contents/alias"));
      const result = await load(root);
      expect(result.project).toBeUndefined();
      expect(result.diagnostics[0]?.code).toBe("CONTENT_SYMLINK");
    }
  });

  test("custom themes require CSS, allow omitted JS, and reserve default", async () => {
    const absent = await configured({ theme: "custom" });
    expect((await load(absent)).project).toBeUndefined();
    const cssOnly = await configured(
      { theme: "custom" },
      { "mdd/themes/custom/theme.css": ":root {}" },
    );
    expect((await load(cssOnly)).project?.theme).toEqual({
      name: "custom",
      directory: "mdd/themes/custom",
      css: "mdd/themes/custom/theme.css",
    });
    const builtin = await configured(
      { theme: "default" },
      { "mdd/themes/default/theme.js": "must not load" },
    );
    expect((await load(builtin)).project?.theme).toEqual({ name: "default" });
  });

  test("optional theme roots cannot hide escaping or broken symlink ancestors", async () => {
    const outside = await fixture();
    const escaped = await configured({ paths: { themes: "linked/missing" } });
    await symlink(outside, path.join(escaped, "mdd/linked"));
    expect((await load(escaped)).diagnostics[0]?.code).toBe(
      "PATH_OUTSIDE_PROJECT",
    );
    const broken = await configured({ paths: { themes: "broken" } });
    await symlink(
      path.join(outside, "absent"),
      path.join(broken, "mdd/broken"),
    );
    expect((await load(broken)).diagnostics[0]?.code).toBe("BROKEN_SYMLINK");
  });

  test("invalid ancestor types and configured symlink cycles produce author diagnostics", async () => {
    const badParent = await configured(
      { paths: { themes: "file/child" } },
      { "mdd/file": "not a directory" },
    );
    expect((await load(badParent)).diagnostics[0]?.code).toBe(
      "INVALID_DIRECTORY",
    );
    const cycle = await configured({ paths: { themes: "cycle" } });
    await symlink("cycle", path.join(cycle, "mdd/cycle"));
    expect((await load(cycle)).diagnostics[0]?.code).toBe("SYMLINK_CYCLE");
  });
});

test("safeFile checks file type, sensitive names, both scopes, and symlink targets", async () => {
  const root = await fixture({
    "mdd/contents/index.md": "# Home",
    "mdd/contents/assets/readme.txt": "safe",
    ".env": "secret",
    "credentials.json": "secret",
    "other.txt": "outside contents",
  });
  const contents = path.join(root, "mdd/contents");
  await symlink(path.join(root, ".env"), path.join(contents, "env.txt"));
  await symlink(
    path.join(contents, "assets/readme.txt"),
    path.join(contents, "readme.txt"),
  );
  expect(await safeFile(root, path.join(contents, "readme.txt"))).toBe(
    path.join(contents, "assets/readme.txt"),
  );
  for (const file of [
    ".env",
    "credentials.json",
    "mdd/contents/env.txt",
    "mdd/contents",
  ]) {
    await expect(safeFile(root, file)).rejects.toBeInstanceOf(AuthoringError);
  }
  await expect(
    safeFile(contents, path.join(root, "other.txt")),
  ).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
});
