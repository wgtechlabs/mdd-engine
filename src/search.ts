/** Versioned, JSON-serializable input for the browser-safe search API. */
export interface SearchIndex {
  version: 1;
  pages: SearchPage[];
}

export interface SearchPage {
  url: string;
  title: string;
  description: string;
  /** Navigation ancestor labels, excluding this page's own label. */
  breadcrumbs?: string[];
  sections: SearchSection[];
}

export interface SearchSection {
  /** Empty for content before the first heading. */
  title: string;
  url: string;
  text: string;
  /** Ancestor headings, excluding this heading and a duplicate page-title H1. */
  breadcrumbs?: string[];
}

export interface SearchOptions {
  /** Maximum results, from 0 to 100. Defaults to 10. */
  limit?: number;
  /** Defaults to one result per page; sections returns independent heading hits. */
  mode?: "pages" | "sections";
  /** Allow one single-edit query correction per result. Requires sections mode. */
  fuzzy?: boolean;
}

/** UTF-16 offsets into the original displayed field; end is exclusive. */
export type SearchMatch = [start: number, end: number];

export interface SearchResult {
  kind: "page" | "section";
  title: string;
  url: string;
  pageUrl: string;
  breadcrumbs: string[];
  /** Present when the destination is a compiled heading. */
  section?: string;
  excerpt: string;
  score: number;
  matches: {
    title: SearchMatch[];
    section: SearchMatch[];
    excerpt: SearchMatch[];
    breadcrumbs: SearchMatch[][];
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function breadcrumbs(value: unknown, maximum: number): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > maximum) return false;
  // Iterate holes too: a sparse array does not contain only string labels.
  for (const label of value) if (typeof label !== "string") return false;
  return true;
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
      !breadcrumbs(page.breadcrumbs, 64) ||
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
        typeof section.text !== "string" ||
        !breadcrumbs(section.breadcrumbs, 6)
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

interface Pattern {
  text: string;
  /** Corrections match complete tokens, never a substring of another word. */
  whole?: boolean;
}

function contains(value: string, pattern: Pattern): boolean {
  return pattern.whole
    ? ` ${value} `.includes(` ${pattern.text} `)
    : value.includes(pattern.text);
}

function mergeRanges(ranges: SearchMatch[]): SearchMatch[] {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: SearchMatch[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1])
      previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** Map normalized matches to complete original graphemes, including NFKC expansions. */
function matchRanges(
  value: string,
  patterns: Pattern[],
  firstOnly = false,
): SearchMatch[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const found: SearchMatch[] = [];
  for (const pattern of patterns) {
    let offset = 0;
    while (offset < normalized.length) {
      const start = normalized.indexOf(pattern.text, offset);
      if (start < 0) break;
      const end = start + pattern.text.length;
      // One neighboring code point needs at most two UTF-16 units. Avoid scanning
      // a growing prefix for each occurrence, or any boundary work for substrings.
      if (
        !pattern.whole ||
        (!/[\p{L}\p{N}\p{M}_]$/u.test(
          normalized.slice(Math.max(0, start - 2), start),
        ) &&
          !/^[\p{L}\p{N}\p{M}_]/u.test(normalized.slice(end, end + 2)))
      ) {
        found.push([start, end]);
        if (firstOnly) break;
      }
      offset = start + 1;
    }
  }
  let ranges = mergeRanges(found);
  if (!ranges.length) return [];
  if (firstOnly) ranges = ranges.slice(0, 1);

  const groups: { text: string; start: number; end: number }[] = [];
  for (const { segment, index } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(value)) {
    let group = {
      text: segment.normalize("NFKC"),
      start: index,
      end: index + segment.length,
    };
    // NFKC can combine adjacent graphemes, e.g. compatibility Hangul ㄱㅏ → 가.
    while (groups.length) {
      const previous = groups.at(-1);
      if (!previous) break;
      const joined = previous.text + group.text;
      const combined = joined.normalize("NFKC");
      if (combined === joined) break;
      groups.pop();
      group = { text: combined, start: previous.start, end: group.end };
    }
    groups.push(group);
  }
  // Whole-field lowercase retains contextual letters such as final sigma.
  // Per-group lowercase supplies only lengths, including expansions like İ.
  const mapped: SearchMatch[] = [];
  let offset = 0;
  let rangeIndex = 0;
  let originalStart = 0;
  for (const group of groups) {
    const next = offset + group.text.toLowerCase().length;
    let range = ranges[rangeIndex];
    while (range && range[0] < next) {
      if (range[0] >= offset) originalStart = group.start;
      if (range[1] > next) break;
      mapped.push([originalStart, group.end]);
      range = ranges[++rangeIndex];
    }
    if (!range) break;
    offset = next;
  }
  return mergeRanges(mapped);
}

function excerpt(value: string, patterns: Pattern[]): string {
  const text = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  if (characters.length <= 160) return text;
  const match = matchRanges(text, patterns, true)[0];
  const matchStart = match ? Array.from(text.slice(0, match[0])).length : 0;
  const matchLength = match
    ? Array.from(text.slice(match[0], match[1])).length
    : 0;
  // Reserve room for both ellipses and the matched term before adding context.
  const context = Math.min(40, Math.max(0, 158 - matchLength));
  const start = Math.min(
    Math.max(0, matchStart - context),
    characters.length - 159,
  );
  let end = Math.min(characters.length, start + 160 - (start > 0 ? 1 : 0));
  if (end < characters.length) end--;
  const startOffset = characters.slice(0, start).join("").length;
  const endOffset = characters.slice(0, end).join("").length;
  // Move clipped edges inward to complete graphemes without exceeding the cap.
  let safeStart = text.length;
  let safeEnd = 0;
  for (const { segment, index } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text)) {
    if (index >= startOffset && safeStart === text.length) safeStart = index;
    if (index + segment.length <= endOffset) safeEnd = index + segment.length;
    if (index >= endOffset) break;
  }
  return `${safeStart > 0 ? "…" : ""}${text.slice(safeStart, safeEnd)}${safeEnd < text.length ? "…" : ""}`;
}

interface Candidate {
  page: SearchPage;
  destination?: SearchSection;
  source: string;
  score: number;
  /** Exact labels, then literal matches, then corrections, in section mode. */
  rank: number;
  patterns: Pattern[];
}

function candidateUrl(candidate: Candidate): string {
  return candidate.destination?.url ?? candidate.page.url;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const aUrl = candidateUrl(a);
  const bUrl = candidateUrl(b);
  return (
    b.rank - a.rank ||
    b.score - a.score ||
    (aUrl < bUrl ? -1 : aUrl > bUrl ? 1 : 0)
  );
}

function sourceText(
  sources: string[],
  patterns: Pattern[],
  fallback: string,
): string {
  return (
    sources.find((text) => {
      const normalized = normalize(text);
      return patterns.some((pattern) => contains(normalized, pattern));
    }) ??
    sources.find((text) => text) ??
    fallback
  );
}

/** Preserve page-mode weighting, cross-section coverage, and destination selection. */
function pageCandidates(index: SearchIndex, terms: string[]): Candidate[] {
  const phrase = terms.join(" ");
  const patterns = terms.map((text) => ({ text }));
  const results: Candidate[] = [];
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
    results.push({
      page,
      destination: metadataMatch ? undefined : best,
      source: sourceText(
        [
          best?.text ?? "",
          page.description,
          ...page.sections.map((section) => section.text),
        ],
        patterns,
        page.title,
      ),
      score:
        weights.reduce((sum, weight) => sum + weight, 0) +
        (title === phrase
          ? 24
          : sections.some((section) => section.title === phrase)
            ? 12
            : 0),
      rank: 0,
      patterns,
    });
  }
  return results;
}

/** Single insertion, deletion, substitution, or adjacent transposition, on code points. */
function singleEdit(query: string[], token: string): boolean {
  if (token.length > 66) return false;
  const text = Array.from(token);
  if (Math.abs(query.length - text.length) > 1) return false;
  let start = 0;
  while (start < query.length && query[start] === text[start]) start++;
  if (start === Math.min(query.length, text.length)) return true;
  if (query.length === text.length) {
    if (query.slice(start + 1).join("") === text.slice(start + 1).join(""))
      return true;
    return (
      query[start] === text[start + 1] &&
      query[start + 1] === text[start] &&
      query.slice(start + 2).join("") === text.slice(start + 2).join("")
    );
  }
  return query.length > text.length
    ? query.slice(start + 1).join("") === text.slice(start).join("")
    : query.slice(start).join("") === text.slice(start + 1).join("");
}

interface Field {
  text: string;
  weight: number;
}

function fieldScore(fields: Field[], pattern: Pattern): number {
  return Math.max(
    0,
    ...fields
      .filter((field) => contains(field.text, pattern))
      .map((field) => field.weight),
  );
}

function matchFields(
  fields: Field[],
  terms: string[],
  fuzzy: boolean,
  required: Field[] = [],
): { patterns: Pattern[]; score: number; corrected: boolean } | undefined {
  const patterns: Pattern[] = terms.map((text) => ({ text }));
  const weights = patterns.map((pattern) => fieldScore(fields, pattern));
  const missing = weights.flatMap((weight, index) => (weight ? [] : [index]));
  if (!missing.length)
    return {
      patterns,
      score: weights.reduce((a, b) => a + b, 0),
      corrected: false,
    };
  const missingIndex = missing[0];
  if (!fuzzy || missing.length !== 1 || missingIndex === undefined) return;
  const query = Array.from(terms[missingIndex] ?? "");
  if (query.length < 4 || query.length > 32) return;
  const needsOwnCorrection =
    required.length > 0 &&
    !patterns.some((pattern) => fieldScore(required, pattern));
  let correction: string | undefined;
  let correctionWeight = 0;
  for (const field of fields) {
    if (field.weight < correctionWeight) continue;
    for (const token of field.text.split(" ")) {
      if (
        singleEdit(query, token) &&
        (!needsOwnCorrection ||
          fieldScore(required, { text: token, whole: true }) > 0) &&
        (field.weight > correctionWeight ||
          correction === undefined ||
          token < correction)
      ) {
        correction = token;
        correctionWeight = field.weight;
      }
    }
  }
  if (!correction) return;
  patterns[missingIndex] = { text: correction, whole: true };
  weights[missingIndex] = correctionWeight;
  return {
    patterns,
    score: weights.reduce((a, b) => a + b, 0),
    corrected: true,
  };
}

/** Score only page metadata plus a single coherent section, never sibling bodies. */
function sectionCandidates(
  index: SearchIndex,
  terms: string[],
  fuzzy: boolean,
): Candidate[] {
  const phrase = terms.join(" ");
  const results: Candidate[] = [];
  for (const page of index.pages) {
    const title = normalize(page.title);
    const metadata = [
      { text: title, weight: 8 },
      { text: normalize(page.description), weight: 2 },
    ];
    const pageMatch = matchFields(metadata, terms, fuzzy);
    let pageCandidate: Candidate | undefined;
    if (pageMatch) {
      const exact = title === phrase;
      pageCandidate = {
        page,
        source: sourceText(
          [page.description, ...page.sections.map((section) => section.text)],
          pageMatch.patterns,
          page.title,
        ),
        score: pageMatch.score + (exact ? 24 : 0),
        rank: pageMatch.corrected ? 0 : exact ? 2 : 1,
        patterns: pageMatch.patterns,
      };
    }
    for (const section of page.sections) {
      const heading = normalize(section.title);
      const body = normalize(section.text);
      const ownFields = [
        { text: heading, weight: 4 },
        { text: body, weight: 1 },
      ];
      const match = matchFields(
        [...metadata, ...ownFields],
        terms,
        fuzzy,
        ownFields,
      );
      if (!match?.patterns.some((pattern) => fieldScore(ownFields, pattern)))
        continue;
      // Repeated page headings without their own matching body add no useful destination.
      if (
        pageMatch &&
        heading === title &&
        !match.patterns.some((pattern) => contains(body, pattern))
      )
        continue;
      const exact = heading === phrase;
      const candidate: Candidate = {
        page,
        destination: section.url === page.url ? undefined : section,
        source: sourceText(
          [section.text, page.description],
          match.patterns,
          section.title || page.title,
        ),
        score: match.score + (exact ? 12 : 0),
        rank: match.corrected ? 0 : exact ? 2 : 1,
        patterns: match.patterns,
      };
      if (candidate.destination) results.push(candidate);
      else if (
        !pageCandidate ||
        compareCandidates(candidate, pageCandidate) < 0
      )
        pageCandidate = candidate;
    }
    if (pageCandidate) results.push(pageCandidate);
  }
  return results;
}

// Greater than the largest raw score: 32 terms × weight 8 + title bonus 24.
const sectionTierWeight = 281;

function displayResult(candidate: Candidate): SearchResult {
  const { page, destination, patterns } = candidate;
  const isSection = destination !== undefined && destination.url !== page.url;
  const trail = isSection
    ? [
        ...(page.breadcrumbs ?? []),
        page.title,
        ...(destination.breadcrumbs ?? []),
      ]
    : [...(page.breadcrumbs ?? [])];
  const snippet = excerpt(candidate.source, patterns);
  return {
    kind: isSection ? "section" : "page",
    title: page.title,
    pageUrl: page.url,
    url: candidateUrl(candidate),
    ...(destination?.title ? { section: destination.title } : {}),
    breadcrumbs: trail,
    excerpt: snippet,
    score: candidate.rank * sectionTierWeight + candidate.score,
    matches: {
      title: matchRanges(page.title, patterns),
      section: matchRanges(destination?.title ?? "", patterns),
      excerpt: matchRanges(snippet, patterns),
      breadcrumbs: trail.map((label) => matchRanges(label, patterns)),
    },
  };
}

/** Query without filesystem, network, or DOM access; page mode preserves legacy ranking. */
export function search(
  index: SearchIndex,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  validateSearchIndex(index);
  if (options === null || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("Search options must be an object.");
  const limit = options.limit ?? 10;
  const mode = options.mode === undefined ? "pages" : options.mode;
  const fuzzy = options.fuzzy === undefined ? false : options.fuzzy;
  if (!Number.isInteger(limit) || limit < 0 || limit > 100)
    throw new RangeError("Search limit must be an integer from 0 to 100.");
  if (mode !== "pages" && mode !== "sections")
    throw new RangeError("Search mode must be pages or sections.");
  if (typeof fuzzy !== "boolean")
    throw new TypeError("Search fuzzy option must be a boolean.");
  if (fuzzy && mode !== "sections")
    throw new RangeError("Fuzzy search requires sections mode.");
  if (typeof query !== "string")
    throw new TypeError("Search query must be a string.");
  if (query.length > 512)
    throw new RangeError("Search query must not exceed 512 characters.");
  const terms = [...new Set(normalize(query).split(" ").filter(Boolean))];
  if (terms.length > 32)
    throw new RangeError("Search query must not exceed 32 unique terms.");
  if (!terms.length || !limit) return [];
  const results =
    mode === "sections"
      ? sectionCandidates(index, terms, false)
      : pageCandidates(index, terms);
  if (fuzzy && results.length < limit) {
    const literalUrls = new Set(results.map(candidateUrl));
    results.push(
      ...sectionCandidates(index, terms, true).filter(
        (candidate) =>
          candidate.rank === 0 && !literalUrls.has(candidateUrl(candidate)),
      ),
    );
  }
  results.sort(compareCandidates);
  // Original-text mapping and excerpt windows are computed only for final hits.
  return results.slice(0, limit).map(displayResult);
}
