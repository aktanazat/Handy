import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import en from "@/i18n/locales/en/translation.json";
import { PrepCard, WrapCard } from "./ConsentPanel";

const i18n = createInstance();
void i18n.init({ lng: "en", resources: { en: { translation: en } } });
const noop = () => undefined;

describe("meeting ritual cards", () => {
  test("PREP renders the prior headline, exact top two loops, counts, and actions", () => {
    const markup = renderToStaticMarkup(
      <PrepCard
        card={{
          eventKey: "weekly#next",
          seriesKey: "weekly",
          title: "Weekly product review",
          startUtcMs: 1_300_000,
          lastMeetingId: "00000000-0000-0000-0000-000000000010",
          headline: "Launch sequencing stayed unresolved.",
          mineOpenLoops: ["Send the launch plan", "Confirm beta dates"],
          mineOpenLoopCount: 3,
          waitingOnCount: 1,
          participants: [
            { name: "Maya", meetingsCount: 6, organization: "Northstar" },
          ],
          canRecordWhenStarts: true,
        }}
        now={1_000_000}
        onAction={noop}
        t={i18n.t}
      />,
    );

    expect(markup).toContain("Weekly product review — in 5 minutes");
    expect(markup).toContain("Launch sequencing stayed unresolved.");
    expect(markup).toContain("Send the launch plan");
    expect(markup).toContain("Confirm beta dates");
    expect(markup).toContain("My open loops (3)");
    expect(markup).toContain("Maya · 6 meetings · Northstar");
    expect(markup).toContain("Record when it starts");
    expect(markup).toContain("Open brief");
  });

  test("WRAP renders the saved headline, measured deltas, and three actions", () => {
    const markup = renderToStaticMarkup(
      <WrapCard
        card={{
          sessionId: "00000000-0000-0000-0000-000000000020",
          title: "Weekly product review",
          headline: "The launch plan is ready for review.",
          followUpCount: 2,
          waitingOnCount: 1,
          waitingOnNames: ["Maya"],
        }}
        copied={false}
        onAction={noop}
        onCopy={noop}
        t={i18n.t}
      />,
    );

    expect(markup).toContain("Weekly product review — saved");
    expect(markup).toContain("The launch plan is ready for review.");
    expect(markup).toContain("2 follow-ups · 1 waiting on Maya");
    expect(markup).toContain("Open notes");
    expect(markup).toContain("Copy follow-up");
    expect(markup).toContain("Done");
  });

  /* The disclosure the panel pastes into the meeting's chat is a catalog line
   * with the notetaker's name in it. The name is the whole reason the sentence
   * exists, so a placeholder that stops interpolating — a rename, a typo — would
   * put "{{name}}" in somebody else's chat. */
  test("the recording disclosure names the person the notes are for", () => {
    expect(i18n.t("consentPanel.announceLine", { name: "Aktan" })).toBe(
      "Sona is taking notes for Aktan. Say so if you'd rather it didn't.",
    );
    expect(i18n.t("consentPanel.announceInChat")).toBe("Announce in chat");
    expect(i18n.t("consentPanel.announceRefused")).not.toContain("{{");
  });
});
