/**
 * Bundled release notes, keyed by the app version each one describes.
 *
 * These used to be `*.md` files collected by `import.meta.glob`. That was a
 * Vite API; Turbopack has no glob and cannot import a `.md` file at all
 * ("Unknown module type"), so registering a raw-text webpack loader would be
 * the only way back to loose Markdown files — a build-time dependency for one
 * string. The notes live here instead: same Markdown, still rendered by
 * `MarkdownContent`, one file to edit per release and no bundler machinery.
 *
 * The renderer supports paragraphs, headings, lists, links, code, quotes,
 * separators, hard line breaks and local images under `/release-notes/...`;
 * raw HTML is stripped before rendering. Keep entries to headline user-facing
 * changes. Escape any literal backtick as \` — these are template literals.
 */
export const RELEASE_NOTE_MARKDOWN = {
  "1.0.0": `# Sona 1.0.0

Sona introduces a new application identity, package name, data directory, log name, and agent-hook sidecar.

On the first launch, Sona can move settings, history, recordings, models, and configured provider keys from the Legacy app. Close the Legacy app before migration, then remove it using the normal uninstall flow for your platform. Sona needs new Microphone and Accessibility permissions because it is a new application identity.

Environment variables now use the \`SONA_\` prefix. The release does not add automatic updates, notarization, or distribution signing.
`,
};
