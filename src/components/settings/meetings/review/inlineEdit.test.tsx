import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { MeetingReviewSnapshot } from "@/bindings";
import {
  committedEdit,
  inlineEditKeys,
  type InlineEditKeyEvent,
} from "./inlineEdit";
import { SpeakerNameEditor } from "./SpeakerRoster";
import { TranscriptTurn, type TranscriptTurnProps } from "./TranscriptTab";

/* Editing on demand, from both sides.
 *
 * The reading surface hides every field and every destructive action until
 * somebody asks for one, so two things have to be nailed down: that the
 * resting turn really is prose, and that the corrections still reach the
 * store. This runner has no DOM, so a control is pressed the way a person
 * names it — by the label on it — and the element tree the component produced
 * is what carries that label to the press. */

const localePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);
const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localePath, "utf8")) },
  },
  interpolation: { escapeValue: false },
  parseMissingKeyHandler: () => "__MISSING__",
});

const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

/** The element tree a component produced, rendered once so its hooks run. */
const treeOf = (
  component: () => React.ReactNode | Promise<React.ReactNode>,
): React.ReactNode => {
  let tree: React.ReactNode = null;
  const Harness = () => {
    // SAFETY: React 19 types every component as possibly async; the two
    // rendered here are plain synchronous functions.
    tree = component() as React.ReactNode;
    return null;
  };
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  return tree;
};

interface ControlProps {
  onClick?: () => void;
  "aria-label"?: string;
  children?: React.ReactNode;
}

const words = (node: React.ReactNode): string => {
  if (node === null || node === undefined || node === true || node === false) {
    return "";
  }
  if (Array.isArray(node)) return node.map(words).join("");
  if (React.isValidElement(node)) {
    // SAFETY: this walker only meets elements this test file rendered, and
    // every one of them carries at most the ControlProps members it reads.
    return words((node.props as ControlProps).children);
  }
  return String(node);
};

const controls = (node: React.ReactNode): ControlProps[] => {
  if (Array.isArray(node)) return node.flatMap(controls);
  if (!React.isValidElement(node)) return [];
  // SAFETY: same first-party tree as `words`; only ControlProps members read.
  const props = node.props as ControlProps;
  return [
    ...(props.onClick === undefined ? [] : [props]),
    ...controls(props.children),
  ];
};

/** Press the control a person would name, by the words or the name on it. */
const press = (node: React.ReactNode, label: string) => {
  const control = controls(node).find(
    (candidate) =>
      candidate["aria-label"] === label || words(candidate.children) === label,
  );
  if (control?.onClick === undefined) {
    throw new Error(`no control labelled "${label}"`);
  }
  control.onClick();
};

const keyPress = (key: string, value: string, shiftKey = false) => {
  let prevented = false;
  const event: InlineEditKeyEvent = {
    key,
    shiftKey,
    currentTarget: { value },
    preventDefault: () => {
      prevented = true;
    },
  };
  return { event, prevented: () => prevented };
};

describe("what a finished inline edit asks for", () => {
  test("a changed draft is the trimmed words", () => {
    expect(
      committedEdit("  We ship on Thursday.  ", "We ship this week."),
    ).toBe("We ship on Thursday.");
  });

  test("an untouched draft asks for nothing, whitespace and all", () => {
    expect(
      committedEdit("We ship this week.", "We ship this week."),
    ).toBeNull();
    expect(
      committedEdit("  We ship this week. ", "We ship this week."),
    ).toBeNull();
  });

  /* Emptying the field is somebody changing their mind, not a request to
   * delete the words: removal is its own action with its own receipt. */
  test("an emptied draft asks for nothing", () => {
    expect(committedEdit("", "We ship this week.")).toBeNull();
    expect(committedEdit("   \n ", "We ship this week.")).toBeNull();
  });
});

describe("the keyboard half of commit-on-intent", () => {
  test("Enter commits what the field holds, and goes no further", () => {
    const asked: string[] = [];
    const typed = keyPress("Enter", "We ship on Thursday.");
    inlineEditKeys(
      (draft) => asked.push(draft),
      () => asked.push("cancelled"),
    )(typed.event);

    expect(asked).toEqual(["We ship on Thursday."]);
    expect(typed.prevented()).toBe(true);
  });

  test("Shift+Enter is a line break, so nothing is committed", () => {
    const asked: string[] = [];
    const typed = keyPress("Enter", "We ship on Thursday.", true);
    inlineEditKeys(
      (draft) => asked.push(draft),
      () => asked.push("cancelled"),
    )(typed.event);

    expect(asked).toEqual([]);
    expect(typed.prevented()).toBe(false);
  });

  test("Escape abandons the draft without asking for a write", () => {
    const asked: string[] = [];
    const typed = keyPress("Escape", "Something half-typed");
    inlineEditKeys(
      (draft) => asked.push(draft),
      () => asked.push("cancelled"),
    )(typed.event);

    expect(asked).toEqual(["cancelled"]);
    expect(typed.prevented()).toBe(true);
  });
});

const TURN: TranscriptTurnProps = {
  segmentId: "segment-1",
  time: "0:12",
  speaker: "Dana",
  text: "We ship the meetings redesign this week.",
  query: "",
  removed: false,
  landed: false,
  flashing: false,
  editing: false,
  disabled: false,
  onOpenEdit: () => undefined,
  onCommit: () => undefined,
  onCancel: () => undefined,
  onRemove: () => undefined,
};

const turn = (overrides: Partial<TranscriptTurnProps> = {}) =>
  render(<TranscriptTurn {...TURN} {...overrides} />);

describe("a transcript turn at rest", () => {
  const markup = turn();

  test("is the words, the speaker and the moment — and no controls", () => {
    expect(markup).toContain("We ship the meetings redesign this week.");
    expect(markup).toContain(">Dana<");
    expect(markup).toContain(">0:12<");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain(">Remove segment<");
    expect(markup).not.toContain("__MISSING__");
  });

  test("carries the dom id a citation resolves it by, and can be focused", () => {
    expect(markup).toContain('id="meeting-transcript-segment-segment-1"');
    expect(markup).toContain('tabindex="0"');
  });

  test("offers one quiet way in, named for what it does", () => {
    expect(markup).toContain('aria-label="Edit this turn"');
  });

  test("a turn nobody may edit offers no way in at all", () => {
    const locked = turn({ disabled: true });
    expect(locked).toContain("We ship the meetings redesign this week.");
    expect(locked).not.toContain('aria-label="Edit this turn"');
  });

  test("the live filter marks the words it matched inside the prose", () => {
    const filtered = turn({ query: "meetings" });
    expect(filtered).toContain("<mark");
    expect(filtered).toContain(">meetings</mark>");
    expect(filtered).toContain("We ship the ");
  });
});

describe("a transcript turn being corrected", () => {
  const markup = turn({ editing: true });

  test("puts the field in the words' own place, and takes the pencil away", () => {
    expect(markup).toContain("<textarea");
    expect(markup).toContain('aria-label="Transcript segment"');
    expect(markup).toContain("We ship the meetings redesign this week.");
    expect(markup).not.toContain('aria-label="Edit this turn"');
  });

  test("is the only place removal is offered, and it reads as removal", () => {
    expect(markup).toContain(">Remove segment<");
    expect(markup).toContain("text-red-900");
  });

  test("removal asks the store to remove this turn, not to rewrite it", () => {
    const asked: [string, boolean][] = [];
    const tree = treeOf(() =>
      TranscriptTurn({
        ...TURN,
        editing: true,
        onRemove: () => asked.push([TURN.segmentId, true]),
      }),
    );

    press(tree, "Remove segment");
    expect(asked).toEqual([["segment-1", true]]);
  });

  test("pressing the pencil is what opens the field", () => {
    const opened: string[] = [];
    const tree = treeOf(() =>
      TranscriptTurn({ ...TURN, onOpenEdit: () => opened.push("open") }),
    );

    press(tree, "Edit this turn");
    expect(opened).toEqual(["open"]);
  });

  /* A turn already struck out has nothing left to remove, so the action that
   * would do it a second time is not drawn. */
  test("a turn already removed is offered no second removal", () => {
    const gone = turn({ editing: true, removed: true });
    expect(gone).toContain("<textarea");
    expect(gone).not.toContain(">Remove segment<");
  });
});

const speaker = (
  speakerId: string,
  displayName: string,
): MeetingReviewSnapshot["speakers"][number] => ({
  speaker_id: speakerId,
  session_id: "meeting-1",
  source_kind: "microphone",
  display_name: displayName,
  revision: 1,
});

const DANA = speaker("speaker-1", "Dana");
const AMIR = speaker("speaker-2", "Amir");

describe("a speaker chip being renamed", () => {
  const markup = render(
    <SpeakerNameEditor
      speaker={DANA}
      others={[AMIR]}
      onCommit={() => undefined}
      onCancel={() => undefined}
      onMerge={() => undefined}
    />,
  );

  test("is a field holding the name, with no Save beside it", () => {
    expect(markup).toContain('aria-label="Speaker name"');
    expect(markup).toContain('value="Dana"');
    expect(markup).not.toContain(">Save<");
  });

  test("states the merge as a sentence about a person, not as two dropdowns", () => {
    expect(markup).toContain(">Same person as Amir<");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain(">Merge speakers<");
  });

  test("merging asks the store to fold this speaker into the named one", () => {
    const asked: string[] = [];
    const tree = treeOf(() =>
      SpeakerNameEditor({
        speaker: DANA,
        others: [AMIR],
        onCommit: () => undefined,
        onCancel: () => undefined,
        onMerge: (targetSpeakerId) => asked.push(targetSpeakerId),
      }),
    );

    press(tree, "Same person as Amir");
    expect(asked).toEqual(["speaker-2"]);
  });

  test("the only speaker in the room is nobody else, so nothing to merge", () => {
    const alone = render(
      <SpeakerNameEditor
        speaker={DANA}
        others={[]}
        onCommit={() => undefined}
        onCancel={() => undefined}
        onMerge={() => undefined}
      />,
    );

    expect(alone).toContain('aria-label="Speaker name"');
    expect(alone).not.toContain("Same person as");
  });
});
