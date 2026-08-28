declare module "*?viewer-behavior-test" {
  export function parseFragment(hash: string): Uint8Array;
  export function renderMarkdown(container: Element, source: string): void;
}

declare module "*?viewer-schema-test" {}
