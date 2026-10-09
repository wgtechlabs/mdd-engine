# Headless documentation search

The engine builds a portable search index from a successfully compiled `Site` and queries that index without a server, filesystem, browser DOM, or network request. MDD owns exporting/loading the index, the search interface, keyboard navigation, and result presentation. Themes style that interface.

```ts
import { compileProject, createSearchIndex } from "@wgtechlabs/mdd-engine";

const result = await compileProject({
  projectDir: "/path/to/project",
  basePath: "/repository/docs/",
});
if (!result.site) throw new Error("Fix the compilation diagnostics first.");

const index = createSearchIndex(result.site);
const json = JSON.stringify(index); // Persist or deliver this in the consuming application.
```

Query from Node or a browser bundle through the dependency-free subpath:

```ts
import { search, validateSearchIndex } from "@wgtechlabs/mdd-engine/search";

const index: unknown = JSON.parse(json);
validateSearchIndex(index); // Narrows unknown input to SearchIndex.
const results = search(index, "installation", { limit: 10 });
// [{ title, url, section?, excerpt, score }]
```

`search` validates its index on every call, including after JSON deserialization. The explicit validator is useful for TypeScript narrowing and early loading errors. The `/search` module imports no compiler, Markdown parser, Node modules, or other dependencies. Browser clients should use that subpath; the package root includes compilation and index construction.

## Index contract

The index is JSON data with `version: 1` and a URL-sorted `pages` array. Each page contains its compiled `url`, `title`, `description` (empty when absent), and document-ordered `sections`. Each section contains `title`, `url`, and readable `text`. The first section represents content before the first heading and has an empty title and the page URL.

Only `site.pages` enters the index. The builder reads normalized page Markdown rather than HTML or source files. It preserves readable paragraphs, lists, tables, code, image alternative text, and component labels/bodies, with whitespace collapsed. Formatting markers, link destinations that are not visible text, source paths, navigation labels, global footer content, theme files, and unreferenced files are excluded. An autolink's URL remains searchable because it is visible text.

Recognized GitHub alerts contribute their readable label (for example, `Warning`) and body. Escaped markers, code examples, and nested blockquotes retain their literal text rather than becoming alert labels.

Section URLs reuse the compiled page URL and the exact compiled heading ID, encoded as a fragment. The builder verifies that the normalized Markdown headings match the compiled heading metadata; disagreement throws rather than inventing anchors. Duplicate headings keep their compiler-assigned suffixes. `/`, `/docs/`, nested deployment prefixes, and encoded path segments are preserved. Rebuilding the same compiled pages produces the same index, including when their array order changes. No input is mutated.

## Matching and ranking

- Normalize query and indexed text with Unicode NFKC, then locale-independent lowercase. Canonically equivalent accents and full-width characters match; accents are not removed, so `cafe` does not match `café`.
- Replace punctuation, symbols, and whitespace with word separators. Letters, numbers, combining marks, and underscores remain. Match each unique query term as a substring; this supports partial terms and CJK text without requiring an English tokenizer. There is no stemming, fuzzy matching, quoted-phrase syntax, or semantic search.
- Require every term somewhere in the same page. Repeated terms do not increase its score. Empty, whitespace-only, symbol-only, and unmatched queries return `[]`.
- For each term, use its strongest field: page title **8**, section heading **4**, description **2**, body **1**. Add **24** for an exact normalized page-title match, otherwise **12** for an exact section-heading match. Sort by descending score and then destination URL using deterministic code-point comparison.
- Return at most one result per page. Title/description-only matches link to the page. Otherwise, choose the highest-scoring section covering the terms not supplied by the page metadata, with document order breaking ties. Terms distributed across separate sections link to the page.

`title` is the page title, and optional `section` identifies the target heading. `excerpt` is plain text from the best matching section's body, falling back to description, first nonempty body, or page title. It starts at that text's beginning and is capped at 160 Unicode code points, including an ellipsis when truncated. It contains no highlighting markup. The numeric `score` supports ordering and is not a probability or stable relevance scale across future index versions.

Default result limit is **10**; `limit` must be an integer from **0** to **100**, with zero returning no results. Queries are capped at **512 UTF-16 code units** and **32 unique normalized terms**. Invalid options or oversized queries throw `RangeError`; malformed queries/indexes throw `TypeError`.

## Boundaries and limitations

Deserialized indexes must have version 1, string metadata/text, unique page/section URLs, and internal absolute page paths. Validation rejects external/protocol-relative/executable URLs, queries, traversal, control characters, malformed encoding, and sections outside their owning page. Section fragments must use the compiler's `mdd-` prefix and canonical fragment encoding. Unknown extra properties are ignored.

Validation establishes shape and safe internal link destinations, not authenticity or whether a URL actually exists on a host. Build indexes from the same compiled site being served. Display all titles, section names, and excerpts as text (for example, `textContent`); do not insert them as raw HTML. A tampered index can supply misleading text even when its links are safe. The engine does not fetch or authenticate index files.

This is a synchronous lexical search for documentation-sized corpora. It scans and normalizes the index per query, with no hidden cache or caller-owned state mutation. The consuming app controls corpus size, loading policy, debouncing, and optional worker execution. The result limit bounds returned items, not index size or scan cost. Hosted search services, embeddings, UI components, and file emission are outside this API.
