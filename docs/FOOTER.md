# Shared footer

Add an optional `footer.md` beside `config.json`, normally at `mdd/footer.md`:

```markdown
:::socials
- [GitHub](https://github.com/wgtechlabs)
- [Community](https://example.org/community)
:::
```

This is a shared site document, not an article. With a custom `mddDir`, the engine looks for `footer.md` in that directory. Missing and whitespace-only files mean no shared footer. The file must be a regular file within the project; footer symlinks are rejected.

## Authoring rules

- Use exactly one `:::socials` container with a flat unordered list.
- Each list item contains one direct Markdown link with a nonempty plain-text label. Labels may include emoji.
- Use absolute HTTPS destinations. Credentials, whitespace, control characters, and backslashes are rejected. Valid query strings and fragments are preserved. The engine does not fetch external links.
- Frontmatter, container labels/attributes, raw HTML, images, nested content, task lists, reference-style links, and unrelated blocks are unsupported.
- `:::socials` is only supported in the shared footer. It is not an article component.

Invalid content fails compilation with an `INVALID_FOOTER`, `INVALID_SOCIAL_LINK`, or `UNSAFE_SOCIAL_URL` diagnostic containing the source file and available line/column. File safety failures use the normal project diagnostics, or `FOOTER_SYMLINK`. Unexpected I/O failures are not treated as an absent footer.

## Headless contract

```ts
interface SocialLink {
  label: string;
  url: string;
}

interface Footer {
  source: string; // POSIX path relative to projectDir
  socials: SocialLink[];
}

// Site.footer?: Footer
```

Links retain author order, and URLs use the standard URL serialization. The engine does not return footer HTML or choose icons. MDD composes the shared links into its main page footer, maps supported labels to trusted built-in icons, and displays other labels as text. Themes control styling. No author scripts, SVG, or HTML are executed by this contract.

The shared footer is excluded from `Site.pages`, navigation, routes, article HTML/Markdown, and content assets. A different file such as `mdd/contents/footer.md` remains an ordinary page. Consumers should keep the shared file out of agent article lists and watch its creation, edits, and deletion when providing live previews.
