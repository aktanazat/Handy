import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "./Input";
import { Tabs, type TabItem } from "./Tabs";

/* Two primitives, two defects that kept coming back because neither invariant
 * had an owner:
 *
 * 1. A field with a leading icon must reserve room for it. Every page that
 *    wanted a search glyph used to position it absolutely and then guess at a
 *    padding override, and the Library's search shipped with its placeholder
 *    running underneath the magnifier. The padding now belongs to the variant,
 *    so what these tests defend is that a slot always brings its padding.
 * 2. A segmented control's active segment must be unmistakable. `bg-subtle`
 *    alone is 4/255 off the page in light mode, which is how the History /
 *    Meetings strip ended up with no visible selection at all.
 */

/** The one <input …> tag out of the rendered wrapper. */
const field = (markup: string): string =>
  markup.slice(
    markup.indexOf("<input"),
    markup.indexOf(">", markup.indexOf("<input")) + 1,
  );

const GLYPH = <svg data-testid="glyph" />;

describe("Input slots", () => {
  test("a leading icon reserves inline-start padding on the field itself", () => {
    const markup = renderToStaticMarkup(
      <Input icon={GLYPH} placeholder="Search" />,
    );
    expect(field(markup)).toContain("ps-8");
  });

  test("the compact variant reserves its own smaller step", () => {
    const markup = renderToStaticMarkup(
      <Input variant="compact" icon={GLYPH} placeholder="Search" />,
    );
    expect(field(markup)).toContain("ps-7");
  });

  test("a field with no icon reserves nothing extra", () => {
    const markup = renderToStaticMarkup(<Input placeholder="Search" />);
    expect(field(markup).includes("ps-8")).toBe(false);
    expect(field(markup).includes("ps-7")).toBe(false);
  });

  test("a trailing control reserves inline-end padding and stays interactive", () => {
    /* A translated label is the caller's business; the slot only has to reserve
       the room and stay clickable, so the control carries an aria-label rather
       than a bare literal child. */
    const markup = renderToStaticMarkup(
      <Input trailing={<button type="button" aria-label="clear" />} />,
    );
    expect(field(markup)).toContain("pe-9");
    /* React self-closes the input, so the trailing slot is everything after
       it — and unlike the leading glyph it must stay clickable. */
    const trailingSlot = markup.slice(markup.lastIndexOf("<span"));
    expect(trailingSlot).toContain("<button");
    expect(trailingSlot.includes("pointer-events-none")).toBe(false);
  });

  test("the leading glyph never takes the pointer from the field", () => {
    const markup = renderToStaticMarkup(<Input icon={GLYPH} />);
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain('aria-hidden="true"');
  });

  test("a bare field is still a bare input, with no wrapper around it", () => {
    const markup = renderToStaticMarkup(<Input placeholder="Search" />);
    expect(markup.startsWith("<input")).toBe(true);
  });
});

const ITEMS: readonly TabItem[] = [
  { id: "history", label: "History" },
  { id: "meetings", label: "Meetings" },
];

const strip = (value: string): string =>
  renderToStaticMarkup(
    <Tabs
      items={ITEMS}
      value={value}
      onChange={() => {}}
      label="Library section"
      variant="secondary"
    />,
  );

/** The markup of the one segment whose aria-selected is true. */
const activeSegment = (markup: string): string => {
  const start = markup.lastIndexOf(
    "<button",
    markup.indexOf('aria-selected="true"'),
  );
  return markup.slice(
    start,
    markup.indexOf(">", markup.indexOf('aria-selected="true"')) + 1,
  );
};

describe("segmented tabs", () => {
  test("the active segment carries a fill and a border, not just a weight", () => {
    const active = activeSegment(strip("history"));
    expect(active).toContain("bg-surface-raised");
    expect(active).toContain("border-border");
    expect(active).toContain("font-semibold");
  });

  test("an idle segment carries neither", () => {
    const markup = strip("history");
    const idle = markup.slice(markup.indexOf('aria-selected="false"'));
    expect(idle.includes("bg-surface-raised")).toBe(false);
  });

  test("the strip is a track, so the control reads as a switch when unread", () => {
    expect(strip("history")).toContain("bg-surface-sunken");
  });

  test("exactly one segment is selected", () => {
    const markup = strip("meetings");
    expect(markup.split('aria-selected="true"').length - 1).toBe(1);
    expect(activeSegment(markup)).toContain("bg-surface-raised");
  });
});
