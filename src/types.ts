export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface Metadata {
  title?: string;
  description?: string;
  navTitle?: string;
  order?: number;
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface Page {
  /** POSIX path relative to projectDir. */
  source: string;
  /** Encoded, trailing-slash path relative to the documentation root. */
  route: string;
  url: string;
  title: string;
  description?: string;
  html: string;
  markdown: string;
  headings: Heading[];
  navigation: { title: string; order?: number };
}

export interface NavigationItem {
  title: string;
  route?: string;
  url?: string;
  children?: NavigationItem[];
}

export interface Asset {
  /** POSIX path relative to projectDir; consumers resolve against the same checkout. */
  source: string;
  /** Filesystem output path relative to the documentation root; not URL-encoded. */
  destination: string;
  url: string;
}

export type Theme =
  | { name: "default" }
  | { name: string; directory: string; css: string; js?: string };

export interface Site {
  title: string;
  basePath: string;
  pages: Page[];
  navigation: NavigationItem[];
  assets: Asset[];
  theme: Theme;
}

export interface CompileOptions {
  projectDir: string;
  mddDir?: string;
  basePath?: string;
}

export type CompileResult =
  | { site: Site; diagnostics: Diagnostic[] }
  | { site?: undefined; diagnostics: Diagnostic[] };
