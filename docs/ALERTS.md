# GitHub-style alerts

Use alerts for short information readers should notice while reading a page. Write a blockquote at the document root with an exact uppercase marker on its own opening line. Keep the body in ordinary Markdown.

The compatibility reference is [GitHub's documented alert syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts), with the precise supported cases described below.

```markdown
> [!NOTE]
> Useful context for this step.

> [!TIP]
> A quicker way to complete the task.

> [!IMPORTANT]
> Information required to complete the task.

> [!WARNING]
> Check this before proceeding.

> [!CAUTION]
> This operation can remove your saved work.
```

Each alert can contain paragraphs, emphasis, links, lists, and code fences. Prefix body lines with `>` and use a blank quoted line (`>`) between paragraphs or blocks. Existing content rules still apply, including local-link validation and rejection of raw HTML and unsafe URLs.

Only blockquotes directly under the document root become alerts. A blockquote nested in another quote, a list item, or `:::details` remains an ordinary quote. Lowercase or unknown markers and a marker followed by body text on the same line are also ordinary blockquotes. For example, `> [!note]`, `> [!CUSTOM]`, and `> [!NOTE] Inline text` do not activate an alert. Examples inside fenced code blocks remain code.

Ordinary Markdown parsing takes precedence: the marker must be plain text in the blockquote's opening paragraph. If a matching `[!NOTE]: ...` reference definition turns `[!NOTE]` into a shortcut reference link, it stays a linked blockquote. If the next quoted line is a setext underline (`===` or `---`) that turns the marker into a heading, it stays a heading inside an ordinary blockquote.

## Output and theme hooks

The engine emits semantic article HTML. A note starts with:

```html
<aside class="mdd-alert mdd-note">
  <p class="mdd-component-label"><strong>Note</strong></p>
  <p>Useful context for this step.</p>
</aside>
```

| Marker | Visible label | Type class |
|---|---|---|
| `[!NOTE]` | Note | `mdd-note` |
| `[!TIP]` | Tip | `mdd-tip` |
| `[!IMPORTANT]` | Important | `mdd-important` |
| `[!WARNING]` | Warning | `mdd-warning` |
| `[!CAUTION]` | Caution | `mdd-caution` |

Every alert has the shared `mdd-alert` class and a `mdd-component-label` paragraph. The engine owns recognition, validation, semantic HTML, and the readable label. MDD composes the article into its reader; themes own icons, colors, borders, and spacing. The markup remains understandable without theme styling. Alerts are static documentation, so the engine does not add `role="alert"` or live-region behavior.

`Page.markdown` preserves alert markers as `> [!TYPE]` with their Markdown bodies. Normalization can change whitespace and resolve links, but it does not replace the marker with a bold label or export the generated HTML wrapper. This keeps the content recognizable to Markdown readers and agents.

## Migrate removed callout directives

The old directives are removed, with no compatibility aliases:

| Removed directive | Replacement opening line |
|---|---|
| `:::note` | `> [!NOTE]` |
| `:::tip` | `> [!TIP]` |
| `:::warning` | `> [!WARNING]` |

Using one produces a `REMOVED_COMPONENT` error with migration guidance and a source location. Compilation does not return a partial site. Replace the directive and closing `:::` with a root-level blockquote, prefix each body line with `>`, and retain the full body. Move a former custom title into the body instead of appending it to the marker.

Before:

```markdown
:::warning[Before deleting files]
Back up **all data** first.

Read the [installation guide](../get-started/installation.md).
:::
```

After:

```markdown
> [!WARNING]
> **Before deleting files**
>
> Back up **all data** first.
>
> Read the [installation guide](../get-started/installation.md).
```

If the removed directive was nested in a list, quote, or disclosure, move the replacement alert to the document root to activate alert rendering. Alternatively, retain a plain nested blockquote when the content should stay inside that structure.

`:::details[More information]` is unchanged. It still renders a disclosure with the `mdd-details` hook, accepts an optional label, and rejects attributes. Its normalized Markdown remains a blockquote with a bold label. See [release guidance](RELEASING.md#breaking-authoring-changes) for the breaking-change commit and promotion policy.
