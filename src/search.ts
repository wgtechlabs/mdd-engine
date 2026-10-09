/** Versioned, JSON-serializable input for the browser-safe search API. */
export interface SearchIndex {
  version: 1;
  pages: SearchPage[];
}

export interface SearchPage {
  url: string;
  title: string;
  description: string;
  sections: SearchSection[];
}

export interface SearchSection {
  /** Empty for content before the first heading. */
  title: string;
  url: string;
  text: string;
}

export interface SearchOptions {
  /** Maximum results, from 0 to 100. Defaults to 10. */
  limit?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  /** Present when the destination is a compiled heading. */
  section?: string;
  excerpt: string;
  score: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pageUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    !value.endsWith("/") ||
    /[?#\\\s\p{Cc}]/u.test(value)
  )
    return false;
  try {
    const parsed = new URL(value, "https://mdd.invalid");
    return (
      parsed.pathname === value &&
      value.split("/").every((part) => {
        const decoded = decodeURIComponent(part);
        return (
          decoded !== "." && decoded !== ".." && !/[/\\\p{Cc}]/u.test(decoded)
        );
      })
    );
  } catch {
    return false;
  }
}

function sectionUrl(value: unknown, page: string): value is string {
  if (value === page) return true;
  if (typeof value !== "string" || !value.startsWith(`${page}#`)) return false;
  try {
    const fragment = value.slice(page.length + 1);
    const id = decodeURIComponent(fragment);
    return (
      id.startsWith("mdd-") &&
      !/\p{Cc}/u.test(id) &&
      fragment === encodeURIComponent(id)
    );
  } catch {
    return false;
  }
}

/** Validate deserialized data before any result can become a link. */
export function validateSearchIndex(
  value: unknown,
): asserts value is SearchIndex {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.pages)) {
    throw new TypeError("Invalid search index: expected version 1 and pages.");
  }
  const urls = new Set<string>();
  for (const page of value.pages) {
    if (
      !record(page) ||
      !pageUrl(page.url) ||
      urls.has(page.url) ||
      typeof page.title !== "string" ||
      typeof page.description !== "string" ||
      !Array.isArray(page.sections)
    )
      throw new TypeError("Invalid search index page.");
    urls.add(page.url);
    const sections = new Set<string>();
    for (const section of page.sections) {
      if (
        !record(section) ||
        !sectionUrl(section.url, page.url) ||
        sections.has(section.url) ||
        typeof section.title !== "string" ||
        typeof section.text !== "string"
      )
        throw new TypeError("Invalid search index section.");
      sections.add(section.url);
    }
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_]+/gu, " ")
    .trim();
}

function excerpt(value: string): string {
  const characters = Array.from(value.replace(/\s+/gu, " ").trim());
  return characters.length > 160
    ? `${characters.slice(0, 159).join("")}…`
    : characters.join("");
}

/** Return at most one hit per page, without filesystem, network, or DOM access. */
export function search(
  index: SearchIndex,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  validateSearchIndex(index);
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
    throw new RangeError("Search limit must be an integer from 0 to 100.");
  }
  if (typeof query !== "string")
    throw new TypeError("Search query must be a string.");
  if (query.length > 512)
    throw new RangeError("Search query must not exceed 512 characters.");
  const terms = [...new Set(normalize(query).split(" ").filter(Boolean))];
  const phrase = terms.join(" ");
  if (terms.length > 32)
    throw new RangeError("Search query must not exceed 32 unique terms.");
  if (!terms.length || !limit) return [];
  const results: SearchResult[] = [];
  for (const page of index.pages) {
    const title = normalize(page.title);
    const description = normalize(page.description);
    const sections = page.sections.map((section) => ({
      section,
      title: normalize(section.title),
      text: normalize(section.text),
    }));
    const weights = terms.map((term): number => {
      if (title.includes(term)) return 8;
      if (sections.some((section) => section.title.includes(term))) return 4;
      if (description.includes(term)) return 2;
      return sections.some((section) => section.text.includes(term)) ? 1 : 0;
    });
    if (weights.some((weight) => weight === 0)) continue;
    const metadataMatch = terms.every(
      (term) => title.includes(term) || description.includes(term),
    );
    const matches = sections
      .map((entry) => ({
        ...entry,
        score: terms.reduce(
          (score, term) =>
            score +
            (entry.title.includes(term)
              ? 4
              : entry.text.includes(term)
                ? 1
                : 0),
          0,
        ),
      }))
      .filter((entry) =>
        terms.every(
          (term) =>
            title.includes(term) ||
            description.includes(term) ||
            entry.title.includes(term) ||
            entry.text.includes(term),
        ),
      );
    // A stable sort preserves document order when multiple sections tie.
    matches.sort((a, b) => b.score - a.score);
    const best = matches[0]?.section;
    const destination = metadataMatch ? undefined : best;
    results.push({
      title: page.title,
      url: destination?.url ?? page.url,
      ...(destination?.title ? { section: destination.title } : {}),
      excerpt: excerpt(
        best?.text ||
          page.description ||
          page.sections.find((section) => section.text)?.text ||
          page.title,
      ),
      score:
        weights.reduce((sum, weight) => sum + weight, 0) +
        (title === phrase
          ? 24
          : sections.some((section) => section.title === phrase)
            ? 12
            : 0),
    });
  }
  results.sort(
    (a, b) => b.score - a.score || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
  );
  return results.slice(0, limit);
}
