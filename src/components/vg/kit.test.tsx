import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";
import { Dialog, DialogFooter } from "./dialog";

/* The dialog footer's one structural promise, and the only thing in this kit
 * that another slice builds on top of.
 *
 * `DialogFooter` lays a single action across the full width and puts two or
 * more at the trailing edge, and it tells them apart with `[&>:only-child]`.
 * That selector reads the DOM, so the promise is not the class string — it is
 * that the actions a caller passes are the footer's own element children.
 * Wrapping them in a layout div is the ordinary way this breaks: every footer
 * would then have exactly one child, and every two-action footer in the app
 * would silently stretch its Cancel button across the sheet. No CSS runs in
 * this test and none needs to; the structure is what the rule keys off.
 *
 * `Dialog` wraps each case because `showCloseButton` renders a Radix `Close`,
 * which needs its root's context. */

/* React emits well-formed markup, so the footer's own element children are a
 * depth walk over its tag stream. No DOM and no `HTMLRewriter`: this repo's
 * tsconfig declares `"types": ["node"]`, so Bun's globals are not in scope for
 * `src/` and `tsc` fails on one. */
const VOID = {
  br: true,
  hr: true,
  img: true,
  input: true,
  source: true,
  wbr: true,
} satisfies Record<string, true>;

const children = (markup: string): string[] => {
  const footer = markup.indexOf('data-slot="dialog-footer"');
  const body = markup.slice(markup.indexOf(">", footer) + 1);
  const tags: string[] = [];
  let depth = 0;
  for (const [, closing, tag, selfClosing] of body.matchAll(
    /<(\/?)([a-z][a-z0-9-]*)[^>]*?(\/?)>/g,
  )) {
    if (closing === "/") {
      if (depth === 0) break; /* the footer's own closing tag */
      depth -= 1;
      continue;
    }
    if (depth === 0) tags.push(tag);
    if (selfClosing !== "/" && !(tag in VOID)) depth += 1;
  }
  return tags;
};

const paint = (node: React.ReactElement): string =>
  renderToStaticMarkup(<Dialog open>{node}</Dialog>);

describe("the dialog footer", () => {
  test("hands its actions to the CSS as its own children", () => {
    const markup = paint(
      <DialogFooter>
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Delete meeting</Button>
      </DialogFooter>,
    );

    expect(children(markup)).toEqual(["button", "button"]);
  });

  test("counts its own close action as one of them", () => {
    const markup = paint(
      <DialogFooter showCloseButton>
        <Button>Choose screen</Button>
      </DialogFooter>,
    );

    expect(children(markup)).toEqual(["button", "button"]);
  });

  test("leaves one action alone", () => {
    const markup = paint(
      <DialogFooter>
        <Button>Import files</Button>
      </DialogFooter>,
    );

    expect(children(markup)).toEqual(["button"]);
  });
});
