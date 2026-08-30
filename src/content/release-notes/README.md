# Release Notes

Add user-facing release notes to the map in `index.ts`, keyed by app version:

```ts
export const RELEASE_NOTE_MARKDOWN = {
  "0.8.4": `# Sona 0.8.4

...
`,
};
```

Markdown lives in the template literal, so escape any literal backtick as
`` \` ``. (Loose `*.md` files cannot be used: the app builds with Turbopack,
which has neither Vite's `import.meta.glob` nor a raw-text importer.)

The update modal shows the highest bundled release note newer than the
persisted `whats_new_last_seen_version` and not newer than the running app
version.

Keep each entry focused on headline user-facing changes. Release notes support
paragraphs, headings, lists, links, code, quotes, separators, hard line breaks,
and local images under `/release-notes/...`. Raw HTML is ignored before
rendering.

Place image assets in `public/release-notes/{version}/` and reference them from
Markdown with absolute paths:

```md
![Streaming transcription preview](/release-notes/0.9.0/streaming-transcription.webp)
```
