import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownContentProps {
  markdown: string;
}

const allowedElements = [
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

const isSafeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const openSafeUrl = async (url: string) => {
  if (!isSafeUrl(url)) return;

  try {
    await openUrl(url);
  } catch (error) {
    console.error("Failed to open release note link:", error);
  }
};

const isSafeImageSrc = (src: string) => {
  if (!src.startsWith("/release-notes/")) return false;
  if (src.includes("\\") || src.includes("..")) return false;

  return true;
};

/* Every colour here comes from the warm gray ramp rather than from the ink at
 * an alpha. Two reasons, and the second is the one that forced it: an alpha on
 * `text-text` is a second vocabulary beside `--gray-900`, so one "quiet body
 * copy" decision was expressed two ways in one app; and on the frosted dialog
 * this modal now sits in, an alpha composites the ink over a translucent
 * tint, which lets the desktop behind the window show through the letters
 * themselves. Every step of the ramp is opaque.
 *
 * Sizes follow the app's ladder: the sheet's own head is 16/25 semibold, the
 * headings under it 14/21, body 14/21, code and notes 13. The kit's
 * `text-base` pair put release notes a step above every other page. */
const components: Components = {
  h1: ({ children }) => (
    <h3 className="text-[16px] leading-[25px] font-semibold text-gray-1000">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="text-[14px] leading-[21px] font-semibold text-gray-1000">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h3 className="text-[14px] leading-[21px] font-medium text-gray-1000">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="text-[14px] leading-[21px] text-gray-900">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 ps-5 text-[14px] leading-[21px] text-gray-900">
      {children}
    </ul>
  ),
  li: ({ children }) => (
    <li className="ps-1 marker:text-gray-800">{children}</li>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 ps-5 text-[14px] leading-[21px] text-gray-900">
      {children}
    </ol>
  ),
  br: () => <br />,
  hr: () => <hr className="border-gray-alpha-400" />,
  img: ({ alt, src }) => {
    /* SAFETY: React 19 widened an <img>'s `src` prop to `string | Blob`, but
     * react-markdown builds these nodes from a parsed document, and a text
     * document can only carry a URL string — no Blob exists on this path. */
    const url = src as string | undefined;
    if (!url || !isSafeImageSrc(url)) return null;

    return (
      /* The inset hairline is what gives a screenshot an edge on a surface
       * whose own colour it may share. Inset rather than a border, so it costs
       * no layout. */
      <img
        src={url}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        className="mx-auto block max-h-72 max-w-full rounded-card object-contain ring-1 ring-gray-alpha-400 ring-inset"
      />
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-s border-gray-alpha-500 ps-3 text-[14px] leading-[21px] text-gray-900">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");

    if (isBlock) {
      return (
        <code className="block text-[13px] whitespace-pre">{children}</code>
      );
    }

    return (
      <code className="rounded-xs bg-gray-alpha-200 px-1 py-0.5 text-[0.9em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-control bg-gray-alpha-100 p-3 text-[13px] leading-[20px] text-gray-900">
      {children}
    </pre>
  ),
  a: ({ children, href }) => {
    if (!href || !isSafeUrl(href)) {
      return <>{children}</>;
    }

    return (
      /* The app's one link treatment (see chat/ChatTurns.tsx): ink type with a
       * quiet underline that firms up on hover, rather than a coloured link.
       * The bronze accent is scarce and spent on actions. */
      <a
        href={href}
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault();
          void openSafeUrl(href);
        }}
        className="text-gray-1000 underline decoration-gray-alpha-600 underline-offset-2 hover:decoration-gray-1000"
      >
        {children}
      </a>
    );
  },
};

export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  markdown,
}) => {
  return (
    <div className="space-y-3">
      <ReactMarkdown
        allowedElements={allowedElements}
        components={components}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
};
