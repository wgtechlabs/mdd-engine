import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Install a real tarball into an isolated consumer, then run it with this Node.
// Bun is used only for packaging/dependency installation, never as the consumer runtime.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), "mdd-package-"));
try {
  const archive = path.join(temp, "engine.tgz");
  execFileSync("bun", ["pm", "pack", "--filename", archive], {
    cwd: root,
    stdio: "pipe",
  });
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  assert(entries.includes("package/dist/index.js"));
  assert(entries.includes("package/dist/index.d.ts"));
  assert(
    entries.every((entry) =>
      /^package\/(dist\/|package\.json$|README\.md$|LICENSE$)/.test(entry),
    ),
    `Unexpected package contents: ${entries.join(", ")}`,
  );
  await writeFile(
    path.join(temp, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@wgtechlabs/mdd-engine": `file:${archive}` },
    }),
  );
  execFileSync("bun", ["install", "--ignore-scripts"], {
    cwd: temp,
    stdio: "pipe",
  });
  const contents = path.join(temp, "mdd", "contents");
  await mkdir(path.join(contents, "guide"), { recursive: true });
  await writeFile(
    path.join(contents, "index.md"),
    "# Home\n\n[Install](guide/install.md#install)\n\n:::note\nA headless package.\n:::\n",
  );
  await writeFile(
    path.join(contents, "guide", "install.md"),
    "# Install\n\n[Home](../index.md)\n",
  );
  await writeFile(
    path.join(temp, "consumer.mjs"),
    `
import assert from 'node:assert/strict';
import { compileProject } from '@wgtechlabs/mdd-engine';
assert.equal(typeof globalThis.Bun, 'undefined');
for (const basePath of ['/', '/docs/', '/repository/docs/']) {
  const result = await compileProject({projectDir: process.cwd(), basePath});
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.site.pages.length, 2);
  assert.equal(result.site.title, 'Home');
  assert(result.site.pages.find(p => p.route === '/').html.includes(basePath + 'guide/install/#mdd-install'));
  assert.deepEqual(await compileProject({projectDir: process.cwd(), basePath}), result);
}
console.log('Packed consumer passed on Node ' + process.version);
`,
  );
  const runtimes = process.env.MDD_TEST_NODE_BINARIES?.split(
    path.delimiter,
  ) ?? [process.execPath];
  for (const runtime of runtimes) {
    execFileSync(runtime, ["consumer.mjs"], {
      cwd: temp,
      stdio: "inherit",
      env: { ...process.env, PATH: path.dirname(runtime) },
    });
  }
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(manifest.engines.node, ">=22.0.0");
  const runtimeFiles = await readdir(path.join(root, "dist"));
  for (const file of runtimeFiles.filter((file) => file.endsWith(".js"))) {
    assert(
      !/\bBun\.|["']bun:/.test(
        await readFile(path.join(root, "dist", file), "utf8"),
      ),
      `Bun API in runtime ${file}`,
    );
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
