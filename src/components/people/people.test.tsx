import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type {
  Document,
  MeetingLedger,
  MeetingPersonContextRow,
  Person,
  PersonDetail,
  PersonListEntry,
  PersonMeetingLink,
} from "@/bindings";
import {
  buildFollowUpAgentMessage,
  type FollowUpAgentMessageSource,
} from "@/components/settings/meetings/review/FollowUpAgentAction";
import {
  PreviouslyTogetherBandView,
  previouslyTogetherRows,
} from "@/components/settings/meetings/review/PreviouslyTogetherBand";
import { PeopleListView } from "./PeopleList";
import { PersonDetailView } from "./PersonDetailView";
import { monthlyMeetingCadence } from "./peopleModel";

const localePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);
const catalogue = JSON.parse(fs.readFileSync(localePath, "utf8"));
const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: catalogue } },
  interpolation: { escapeValue: false },
  parseMissingKeyHandler: () => "__MISSING__",
});
const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
const occurrences = (markup: string, needle: string) =>
  markup.split(needle).length - 1;
const noop = () => undefined;

const JANUARY = Date.UTC(2026, 0, 12, 17);
const FEBRUARY = Date.UTC(2026, 1, 4, 17);
const JUNE = Date.UTC(2026, 5, 9, 17);

const PERSON: Person = {
  id: "person-dana",
  display_name: "Dana Reyes",
  aliases: ["Dana R."],
  calendar_emails: ["dana@example.com"],
  created_at_utc_ms: JANUARY,
  updated_at_utc_ms: JUNE,
};
const OTHER_PERSON: Person = {
  ...PERSON,
  id: "person-amir",
  display_name: "Amir Khan",
  aliases: [],
  calendar_emails: ["amir@example.com"],
};
const ENTRY: PersonListEntry = {
  person: PERSON,
  meetings_count: 2,
  last_meeting_at_utc_ms: JUNE,
  suggested_count: 1,
  evidence_sources: ["calendar", "speaker", "title"],
  confirmed_count: 2,
  last_meeting: {
    session_id: "meeting-current",
    title: "Current review",
    at_ms: JUNE,
    headline: { kind: "ledger", text: "Pricing is still open." },
  },
};
const OTHER_ENTRY: PersonListEntry = {
  person: OTHER_PERSON,
  meetings_count: 1,
  last_meeting_at_utc_ms: FEBRUARY,
  suggested_count: 0,
  evidence_sources: ["calendar"],
  confirmed_count: 1,
  last_meeting: {
    session_id: "meeting-planning",
    title: "Planning",
    at_ms: FEBRUARY,
    headline: { kind: "summary", text: "Launch planning." },
  },
};
const CONFIRMED_LINK: PersonMeetingLink = {
  meeting: {
    id: "meeting-planning",
    title: "Planning",
    at_utc_ms: JANUARY,
    headline: "The launch checklist still needs an owner.",
    series_number: 2,
  },
  source: "calendar",
  confidence: "confirmed",
};
const CURRENT_LINK: PersonMeetingLink = {
  meeting: {
    id: "meeting-current",
    title: "Current review",
    at_utc_ms: JUNE,
    headline: "Pricing is still open.",
    series_number: 3,
  },
  source: "speaker",
  confidence: "confirmed",
};
const SUGGESTED_LINK: PersonMeetingLink = {
  meeting: {
    id: "meeting-suggested",
    title: "Launch sync",
    at_utc_ms: FEBRUARY,
    headline: null,
    series_number: 1,
  },
  source: "title",
  confidence: "suggested",
};
const DETAIL: PersonDetail = {
  person: PERSON,
  links: [CONFIRMED_LINK, CURRENT_LINK, SUGGESTED_LINK],
  open_loops: [
    {
      loop_id: "meeting-january:loop:a1b2c3d4e5f60718",
      meeting_id: CONFIRMED_LINK.meeting.id,
      title: CONFIRMED_LINK.meeting.title,
      at_utc_ms: JANUARY,
      text: "Who owns the launch checklist?",
      owner_person_id: PERSON.id,
      status: "open",
      direction: "waiting_on",
      waiting_on_stale: true,
      carried_since_at_utc_ms: JANUARY,
      carried_into_meeting_id: null,
    },
  ],
  commitments: [
    {
      loop_id: "meeting-january:commitment:8796a5b4c3d2e1f0",
      meeting_id: CONFIRMED_LINK.meeting.id,
      title: CONFIRMED_LINK.meeting.title,
      at_utc_ms: JANUARY,
      text: "Dana will send the tier comparison.",
      status: "done",
      direction: "waiting_on",
      waiting_on_stale: false,
      resolved_at_utc_ms: JUNE,
    },
  ],
  talk_share_avg_permille: 347,
  documents: [],
};
const DOCUMENT: Document = {
  summary: {
    id: "document-1",
    title: "Account notes",
    source_name: "account-notes.md",
    media_type: "text/markdown",
    created_at_utc_ms: FEBRUARY,
  },
  content: "Dana prefers a concise weekly update.",
};

const list = (
  entries: React.ComponentProps<typeof PeopleListView>["entries"],
) =>
  render(
    <PeopleListView
      entries={entries}
      error={false}
      onOpenPerson={noop}
      onRetry={noop}
    />,
  );

const detail = (personDetail: PersonDetail, documents: Document[]) =>
  render(
    <PersonDetailView
      detail={personDetail}
      people={[ENTRY, OTHER_ENTRY]}
      documents={documents}
      documentsLoadFailed={false}
      pending={false}
      onBack={noop}
      onRename={noop}
      onMerge={noop}
      onDelete={noop}
      onUnlink={noop}
      onSplit={noop}
      onConfirmLink={noop}
      onImportDocument={noop}
      onDeleteDocument={noop}
      onOpenMeeting={noop}
    />,
  );

describe("People list", () => {
  test("keeps the shared page measure and a one-glyph empty row", () => {
    const markup = list([]);

    expect(markup).toContain("max-w-[760px]");
    expect(occurrences(markup, 'data-slot="people-empty-row"')).toBe(1);
    expect(occurrences(markup, "<svg")).toBe(1);
    expect(markup).not.toContain('data-slot="person-card"');
  });

  test("says a person's name, meeting count and last meeting on one line", () => {
    const markup = list([ENTRY]);

    expect(markup).toContain('data-slot="person-card"');
    expect(markup).toContain("Dana Reyes");
    expect(markup).toContain("2 meetings");
    expect(markup).toContain("Last met");
    /* The line is the whole row. The initial bubble, the last meeting's
     * headline, the evidence chips and the suggested-links footer all moved to
     * the person's own page, which is what the row opens — a list of people is
     * not the place to read one person's meeting. */
    expect(markup).not.toContain('data-slot="meeting-person"');
    expect(markup).not.toContain('data-slot="suggested-links"');
    expect(markup).not.toContain("Pricing is still open.");
    expect(markup).not.toContain("Calendar");
    expect(markup).not.toContain("Launch sync");
    expect(markup).not.toContain(">Dismiss</button>");
    expect(markup).not.toContain(">Confirm</button>");
  });
});

describe("person detail", () => {
  test("keeps every empty section as one quiet row", () => {
    const markup = detail(
      {
        ...DETAIL,
        links: [],
        open_loops: [],
        commitments: [],
        talk_share_avg_permille: null,
      },
      [],
    );

    expect(markup).toContain("max-w-[760px]");
    /* Five sections, five one-line absences: meetings together, open loops,
     * how Sona knows, commitments, imported documents. */
    expect(occurrences(markup, 'data-slot="people-empty-row"')).toBe(5);
    expect(markup).not.toContain('data-slot="person-cadence"');
  });

  test("reads as one catalogue: meetings, then what is open, then the evidence", () => {
    const markup = detail(DETAIL, [DOCUMENT]);

    expect(markup.indexOf("Meetings together")).toBeLessThan(
      markup.indexOf("Open loops"),
    );
    expect(markup.indexOf("Open loops")).toBeLessThan(
      markup.indexOf("How Sona knows"),
    );
    /* Three kinds of evidence across three links: an invite, a voice, a
     * title. The section counts the links already on screen above it and asks
     * the backend nothing. */
    expect(occurrences(markup, 'data-slot="person-evidence-row"')).toBe(3);
    expect(markup).toContain("Calendar");
    expect(markup).toContain("Speaker");
    expect(markup).toContain("Title");
  });

  test("renders cadence, relationship facts, links, and imported context", () => {
    const markup = detail(DETAIL, [DOCUMENT]);

    const cadenceBars =
      markup.match(
        /<svg[^>]*data-slot="person-cadence-bars"[\s\S]*?<\/svg>/u,
      )?.[0] ?? "";
    expect(cadenceBars).not.toBe("");
    expect(occurrences(cadenceBars, "<rect")).toBe(6);
    expect(markup).toContain("34.7%");
    expect(markup).toContain("Who owns the launch checklist?");
    expect(markup).toContain("Dana will send the tier comparison.");
    expect(occurrences(markup, 'data-slot="person-meeting"')).toBe(3);
    expect(markup).toContain('data-slot="person-document"');
    expect(markup).toContain("Dana prefers a concise weekly update.");
    /* The name is the control that renames it, so there is no Rename button
     * beside the title — and split, merge and delete are operations on who
     * this person is, so they wait behind one quiet trigger instead of a row
     * of named buttons. Four triggers: three meeting rows and the header. */
    expect(markup).not.toContain(">Rename</button>");
    expect(markup).not.toContain(">Split person</button>");
    expect(markup).toContain('title="Rename"');
    expect(markup).toContain('aria-label="Person actions"');
    expect(occurrences(markup, 'data-slot="dropdown-menu-trigger"')).toBe(4);
    /* An open loop names the meeting it came from, and the name is the way
     * back into that meeting rather than a caption about it. */
    expect(occurrences(markup, ">Planning</button>")).toBe(2);
  });

  /* D27: a person page answers two questions, so it shows two lists. Grouping
   * them under one heading each is the whole feature — "what did I promise
   * Dana" and "what is Dana sitting on" were previously one undifferentiated
   * column, and the page could not tell you which was which. */
  test("groups what the user owes apart from what this person owes", () => {
    const markup = detail(
      {
        ...DETAIL,
        open_loops: [
          { ...DETAIL.open_loops[0], direction: "waiting_on" },
          {
            ...DETAIL.open_loops[0],
            loop_id: "meeting-january:loop:00112233445566ff",
            text: "Confirm the rebate spreadsheet owner",
            direction: "mine",
            waiting_on_stale: false,
          },
        ],
      },
      [],
    );

    expect(markup).toContain("I owe");
    expect(markup).toContain("Waiting on Dana Reyes");
    // The user's own line comes first: it is the one they can act on.
    expect(markup.indexOf("Confirm the rebate spreadsheet owner")).toBeLessThan(
      markup.indexOf("Who owns the launch checklist?"),
    );
  });

  /* The stale mark only ever lands on a row somebody else owes. A backlog of
   * the user's own work is theirs to schedule; marking it overdue would be the
   * app nagging its user about a decision it did not make. */
  test("marks an overdue handoff and never the user's own backlog", () => {
    const overdue = detail(DETAIL, []);
    expect(occurrences(overdue, 'data-slot="loop-stale"')).toBe(1);
    expect(overdue).toContain("Overdue");

    const mine = detail(
      {
        ...DETAIL,
        open_loops: [
          {
            ...DETAIL.open_loops[0],
            direction: "mine",
            waiting_on_stale: false,
          },
        ],
        commitments: [],
      },
      [],
    );
    expect(mine).not.toContain('data-slot="loop-stale"');
  });

  /* D18: a person page reads the loop's live state, not a copy of the words.
   * The status word is the whole point of the row — a commitment already
   * settled on the review screen must not read the same as one still owed. */
  test("states where each loop stands, and how long the open one has been open", () => {
    const markup = detail(DETAIL, []);

    expect(occurrences(markup, 'data-slot="loop-status"')).toBe(2);
    expect(markup).toContain(">Open<");
    expect(markup).toContain(">Done<");
    expect(markup).toContain("Open since");
  });
});

describe("People projections", () => {
  test("buckets only confirmed links into six UTC months", () => {
    expect(
      monthlyMeetingCadence(
        [CONFIRMED_LINK, CURRENT_LINK, SUGGESTED_LINK],
        Date.UTC(2026, 5, 20),
      ),
    ).toEqual([1, 0, 0, 0, 0, 1]);
  });

  test("shows PREVIOUSLY TOGETHER only when the meeting projection has a prior meeting", () => {
    const context: MeetingPersonContextRow = {
      person_id: PERSON.id,
      display_name: PERSON.display_name,
      evidence_source: "speaker",
      meetings_together: 2,
      last_prior_meeting: {
        id: CONFIRMED_LINK.meeting.id,
        title: CONFIRMED_LINK.meeting.title,
        at_utc_ms: JANUARY,
        headline: CONFIRMED_LINK.meeting.headline,
      },
      top_open_loop: DETAIL.open_loops[0],
    };
    const rows = previouslyTogetherRows([context]);

    expect(rows).toEqual([
      {
        personId: PERSON.id,
        displayName: PERSON.display_name,
        meetingsCount: 1,
        lastMeetingAtUtcMs: JANUARY,
        openLoop: "Who owns the launch checklist?",
      },
    ]);
    const markup = render(
      <PreviouslyTogetherBandView rows={rows} onOpenPerson={noop} />,
    );
    expect(markup).toContain('data-slot="previously-together"');
    expect(markup).toContain('data-slot="meeting-person"');
    expect(markup).toContain("px-4 py-3");
    expect(
      render(<PreviouslyTogetherBandView rows={[]} onOpenPerson={noop} />),
    ).toBe("");
  });
});

describe("follow-up agent prompt", () => {
  test("sends only current ledger commitments and open loops", () => {
    const ledger: MeetingLedger = {
      headline: "Pricing remains open.",
      threads: [],
      open_loops: [
        {
          question: "Which tier does the trial convert into?",
          instead: "The meeting moved on without an answer.",
          at_ms: 12_000,
          citations: [],
        },
      ],
      commitments: [
        {
          who: "Dana",
          what: "Send the tier comparison",
          firmness: "firm",
          receipt: {
            quote: "I will send the tier comparison.",
            speaker: "Dana",
            t_ms: 9_000,
            citations: [],
          },
        },
      ],
      stances: [],
      caveats: [],
      receipts: { status: "verified" },
    };
    /* The builder reads only the ledger; the other artifact fields satisfy
     * the generated shape with empty values production also starts from. */
    const emptyText = { text: "", citations: [] };
    const snapshot: FollowUpAgentMessageSource = {
      session: { title: "Pricing review" },
      artifacts: [
        {
          state: "current",
          content: {
            summary: emptyText,
            outline: [],
            decisions: [],
            action_items: [],
            key_questions: [],
            risks: [],
            follow_up_draft: emptyText,
            ledger,
          },
        },
      ],
    };
    const message = buildFollowUpAgentMessage(snapshot, i18n.t.bind(i18n));

    expect(message).toContain("Pricing review");
    expect(message).toContain("- Dana: Send the tier comparison");
    expect(message).toContain("- Which tier does the trial convert into?");
  });
});
