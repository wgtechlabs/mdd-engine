import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { CompileOptions, Diagnostic, Theme } from "./types.js";

export interface Project {
  root: string;
  contentsRoot: string;
  title?: string;
  theme: Theme;
  files: string[];
}

export class AuthoringError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthoringError";
  }
}

export function relativeSource(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function protectedName(name: string): boolean {
  return (
    name.startsWith(".") ||
    /^(?:node_modules|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/i.test(
      name,
    ) ||
    /\.(?:pem|key|p12|pfx)$/i.test(name)
  );
}

function assertPath(root: string, file: string): void {
  if (!isWithin(root, file)) {
    throw new AuthoringError(
      "PATH_OUTSIDE_PROJECT",
      `Path escapes its allowed root: ${file}`,
    );
  }
  if (relativeSource(root, file).split("/").some(protectedName)) {
    throw new AuthoringError(
      "PROTECTED_PATH",
      `Hidden or sensitive paths cannot be used: ${file}`,
    );
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function checkedPath(
  root: string,
  file: string,
  allowMissing = false,
): Promise<string> {
  const absolute = path.resolve(root, file);
  assertPath(root, absolute);
  let resolved: string;
  try {
    resolved = await realpath(absolute);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ELOOP")
        throw new AuthoringError(
          "SYMLINK_CYCLE",
          `Path contains a symlink cycle: ${absolute}`,
        );
      if (error.code === "ENOTDIR")
        throw new AuthoringError(
          "INVALID_DIRECTORY",
          `A path component is not a directory: ${absolute}`,
        );
    }
    if (missing(error)) {
      if (!allowMissing || absolute === root) {
        throw new AuthoringError(
          "PATH_NOT_FOUND",
          `Path does not exist: ${absolute}`,
        );
      }
      const entry = await lstat(absolute).catch((inspectionError: unknown) => {
        if (missing(inspectionError)) return undefined;
        throw new Error(`Cannot inspect path ${absolute}`, {
          cause: inspectionError,
        });
      });
      if (entry?.isSymbolicLink())
        throw new AuthoringError(
          "BROKEN_SYMLINK",
          `Path is a broken symlink: ${absolute}`,
        );
      // Resolve existing ancestors too: an absent leaf must not conceal a symlink escape.
      resolved = path.join(
        await checkedPath(root, path.dirname(absolute), true),
        path.basename(absolute),
      );
    } else {
      throw new Error(`Cannot resolve path ${absolute}`, { cause: error });
    }
  }
  assertPath(root, resolved);
  return resolved;
}

export async function safeFile(root: string, file: string): Promise<string> {
  const resolved = await checkedPath(root, file);
  try {
    if (!(await stat(resolved)).isFile()) {
      throw new AuthoringError(
        "INVALID_FILE_TYPE",
        `Expected a regular file: ${file}`,
      );
    }
  } catch (error) {
    if (error instanceof AuthoringError) throw error;
    if (missing(error))
      throw new AuthoringError(
        "PATH_NOT_FOUND",
        `File does not exist: ${file}`,
      );
    throw new Error(`Cannot inspect file ${file}`, { cause: error });
  }
  return resolved;
}

async function directory(
  root: string,
  file: string,
  optional = false,
): Promise<string> {
  const resolved = await checkedPath(root, file, optional);
  try {
    if (!(await stat(resolved)).isDirectory()) {
      throw new AuthoringError(
        "INVALID_DIRECTORY",
        `Expected a directory: ${file}`,
      );
    }
  } catch (error) {
    if (error instanceof AuthoringError) throw error;
    if (optional && missing(error)) return resolved;
    throw new Error(`Cannot inspect directory ${file}`, { cause: error });
  }
  return resolved;
}

function object(
  value: unknown,
  label: string,
  fields: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthoringError("INVALID_CONFIG", `${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!fields.includes(key))
      throw new AuthoringError(
        "UNKNOWN_CONFIG_FIELD",
        `Unsupported ${label} field: ${key}`,
      );
  }
  return record;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new AuthoringError(
      "INVALID_CONFIG",
      `${label} must be a non-empty string.`,
    );
  }
  return value;
}

function relativePath(value: unknown, label: string): string {
  const result = text(value, label);
  if (
    path.isAbsolute(result) ||
    path.win32.isAbsolute(result) ||
    result.includes("\\")
  ) {
    throw new AuthoringError(
      "INVALID_CONFIG_PATH",
      `${label} must be a relative path using forward slashes.`,
    );
  }
  return result;
}

async function optionalFile(
  root: string,
  file: string,
): Promise<string | undefined> {
  try {
    await lstat(file);
  } catch (error) {
    if (missing(error)) return undefined;
    throw new Error(`Cannot inspect optional file ${file}`, { cause: error });
  }
  return safeFile(root, file);
}

async function scan(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: unknown) => {
        throw new Error(`Cannot read content directory ${directory}`, {
          cause: error,
        });
      },
    );
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (protectedName(entry.name)) continue;
      const file = path.join(directory, entry.name);
      // Reject aliases during discovery so routes are unambiguous and directory cycles impossible.
      if (entry.isSymbolicLink()) {
        throw new AuthoringError(
          "CONTENT_SYMLINK",
          `Content discovery does not follow symlinks: ${file}`,
        );
      }
      if (entry.isDirectory()) await walk(file);
      else if (path.extname(entry.name).toLowerCase() === ".md")
        files.push(await safeFile(root, file));
    }
  }
  await walk(root);
  return files.sort();
}

export async function loadProject(
  options: CompileOptions,
  diagnostics: Diagnostic[],
): Promise<Project | undefined> {
  let source: string | undefined;
  try {
    const root = await realpath(options.projectDir).catch((error: unknown) => {
      if (missing(error))
        throw new AuthoringError(
          "PROJECT_NOT_FOUND",
          `Project directory does not exist: ${options.projectDir}`,
        );
      throw new Error(
        `Cannot resolve project directory ${options.projectDir}`,
        { cause: error },
      );
    });
    const mddRoot = await directory(
      root,
      relativePath(options.mddDir ?? "mdd", "mddDir"),
    );
    const configPath = path.join(mddRoot, "config.json");
    source = relativeSource(root, configPath);
    const configFile = await optionalFile(root, configPath);
    let config: Record<string, unknown> = {};
    if (configFile) {
      const json = await readFile(configFile, "utf8").catch(
        (error: unknown) => {
          throw new Error(`Cannot read configuration ${configFile}`, {
            cause: error,
          });
        },
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new AuthoringError(
          "INVALID_CONFIG_JSON",
          "config.json must contain valid JSON.",
        );
      }
      config = object(parsed, "config", ["title", "paths", "theme"]);
    }
    const title =
      config.title === undefined ? undefined : text(config.title, "title");
    const paths =
      config.paths === undefined
        ? {}
        : object(config.paths, "paths", ["contents", "themes"]);
    const contentsRoot = await directory(
      root,
      path.resolve(
        mddRoot,
        relativePath(
          paths.contents === undefined ? "contents" : paths.contents,
          "paths.contents",
        ),
      ),
    );
    const themesRoot = await directory(
      root,
      path.resolve(
        mddRoot,
        relativePath(
          paths.themes === undefined ? "themes" : paths.themes,
          "paths.themes",
        ),
      ),
      true,
    );
    if (contentsRoot === root || themesRoot === root) {
      throw new AuthoringError(
        "INVALID_CONTENT_ROOT",
        "Content and theme paths must select a directory inside the project, not the whole checkout.",
      );
    }
    if (
      isWithin(contentsRoot, themesRoot) ||
      isWithin(themesRoot, contentsRoot)
    ) {
      throw new AuthoringError(
        "OVERLAPPING_ROOTS",
        "Content and theme directories must not overlap.",
      );
    }
    const name = text(
      config.theme === undefined ? "default" : config.theme,
      "theme",
    );
    if (
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\") ||
      protectedName(name)
    ) {
      throw new AuthoringError(
        "INVALID_THEME",
        "theme must name a single, non-hidden folder inside the themes directory.",
      );
    }
    let theme: Theme = { name: "default" };
    if (name !== "default") {
      const themeRoot = await directory(root, path.join(themesRoot, name));
      if (!isWithin(themesRoot, themeRoot))
        throw new AuthoringError(
          "PATH_OUTSIDE_PROJECT",
          "Selected theme escapes the themes directory.",
        );
      const css = await safeFile(themeRoot, path.join(themeRoot, "theme.css"));
      const js = await optionalFile(
        themeRoot,
        path.join(themeRoot, "theme.js"),
      );
      theme = {
        name,
        directory: relativeSource(root, themeRoot),
        css: relativeSource(root, css),
        ...(js ? { js: relativeSource(root, js) } : {}),
      };
    }
    source = relativeSource(root, contentsRoot);
    const files = await scan(contentsRoot);
    if (!files.includes(path.join(contentsRoot, "index.md"))) {
      source = relativeSource(root, path.join(contentsRoot, "index.md"));
      throw new AuthoringError(
        "MISSING_HOME",
        "The content root must contain an index.md homepage.",
      );
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error"))
      return undefined;
    return { root, contentsRoot, title, theme, files };
  } catch (error) {
    if (!(error instanceof AuthoringError)) throw error;
    diagnostics.push({
      severity: "error",
      code: error.code,
      message: error.message,
      ...(source ? { file: source } : {}),
    });
    return undefined;
  }
}
