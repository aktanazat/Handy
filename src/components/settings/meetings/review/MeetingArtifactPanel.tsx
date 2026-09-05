import React from "react";
import { useTranslation } from "react-i18next";
import type { MeetingArtifactRevision, MeetingArtifactState } from "@/bindings";
import { cn } from "@/lib/cn";
import { CardBand } from "@/components/settings/CardBand";
import { Microlabel, Notice } from "@/components/settings/rows";
import { Checkbox } from "@/components/vg/checkbox";
import { actionItemKey } from "../meetingAnalytics";
import { CitedText, TracedSummary } from "./Citations";

/* What the meeting said, set as a document.
 *
 * A cream band names it, one opening paragraph answers the name, then
 * labelled sections follow in the order a reader wants them. Nothing here is
 * a box inside a box, nothing announces a section that has no rows, and
 * `current` — the state nine notes out of ten are in — says nothing at all,
 * because a word that is always there tells a reader nothing. */

/** Only the two states worth a word. `current` is silent by construction. */
const ARTIFACT_STATE_CLASSES = {
  out_of_date: "text-amber-900",
  failed: "text-red-900",
} as const satisfies Record<Exclude<MeetingArtifactState, "current">, string>;

const TOPIC_TITLE = "text-[14px] leading-[21px] font-medium text-gray-1000";
const META = "text-[13px] leading-[18px] text-gray-900";

interface MeetingArtifactPanelProps {
  artifact: MeetingArtifactRevision;
  doneActionItems: Set<string>;
  actionsDisabled: boolean;
  onJump: (segmentId: string) => void;
  onActionItemToggle: (
    artifactId: string,
    actionIndex: number,
    done: boolean,
  ) => void;
}

export const MeetingArtifactPanel: React.FC<MeetingArtifactPanelProps> = ({
  artifact,
  doneActionItems,
  actionsDisabled,
  onJump,
  onActionItemToggle,
}) => {
  const { t } = useTranslation();
  const content = artifact.content;
  /* The document's name. `template_id` is the id of the template the artifact
   * was generated from; the catalog names the five this build ships, and
   * i18next answers for anything else with the id humanized — so notes from a
   * template nobody here knows still have a name rather than a raw
   * "Template: meeting-review". */
  const humanized = artifact.template_id.replace(/[-_]+/g, " ").trim();
  const title = t(`meetings.review.templateName.${artifact.template_id}`, {
    defaultValue: humanized.charAt(0).toUpperCase() + humanized.slice(1),
  });
  /* The state word, and the colour it earns. `current` is not a word: it is
   * every note that is not broken. */
  const stateWord =
    artifact.state === "current"
      ? null
      : {
          text: t(`meetings.artifactState.${artifact.state}`),
          tone: ARTIFACT_STATE_CLASSES[artifact.state],
        };
  /* The four sections a reader acts on. When a conversation produced none of
   * them that is one fact about the meeting, said once, rather than four
   * headings each answered with "None". */
  const nothingRecorded =
    content !== null &&
    content.decisions.length === 0 &&
    content.action_items.length === 0 &&
    content.key_questions.length === 0 &&
    content.risks.length === 0;

  return (
    <article className="flex flex-col">
      <CardBand
        as="h3"
        title={title}
        meta={stateWord?.text}
        metaClassName={stateWord?.tone}
      />
      <div className="flex flex-col gap-6 px-6 py-5">
        {/* The summary is the document's lede: it sits under the band with no
         * label, because a first paragraph does not need to be introduced. */}
        {content === null ? (
          <Notice tone="muted" live={false}>
            {t("meetings.review.artifactUnavailable")}
          </Notice>
        ) : (
          <TracedSummary
            summary={content.summary}
            trace={content.summary_trace}
            onJump={onJump}
          />
        )}
        {content === null ? null : (
          <>
            {content.outline.length === 0 ? null : (
              <ArtifactSection label={t("meetings.review.topics")}>
                <ol className="flex list-none flex-col gap-4">
                  {content.outline.map((topic, index) => (
                    <li
                      key={`${artifact.artifact_id}:topic:${index}`}
                      className="flex flex-col gap-1"
                    >
                      <CitedText
                        value={topic.title}
                        onJump={onJump}
                        className={TOPIC_TITLE}
                      />
                      {topic.detail ? (
                        <CitedText value={topic.detail} onJump={onJump} />
                      ) : null}
                    </li>
                  ))}
                </ol>
              </ArtifactSection>
            )}

            {nothingRecorded ? (
              <p className={META}>{t("meetings.review.nothingRecorded")}</p>
            ) : null}

            {content.decisions.length === 0 ? null : (
              <ArtifactSection label={t("meetings.review.decisions")}>
                <ul role="list" className="flex flex-col gap-4">
                  {content.decisions.map((decision, index) => (
                    <li key={`${artifact.artifact_id}:decision:${index}`}>
                      <CitedText value={decision} onJump={onJump} />
                    </li>
                  ))}
                </ul>
              </ArtifactSection>
            )}

            {content.action_items.length === 0 ? null : (
              <ArtifactSection label={t("meetings.review.actions")}>
                <ul role="list" className="flex flex-col gap-4">
                  {content.action_items.map((action, index) => {
                    const key = actionItemKey(artifact.artifact_id, index);
                    const done = doneActionItems.has(key);
                    const owner = action.owner_text;
                    const due = action.due_text;
                    const meta =
                      owner === null
                        ? due === null
                          ? null
                          : t("meetings.review.actionDue", { due })
                        : due === null
                          ? t("meetings.review.actionOwner", { owner })
                          : t("meetings.review.actionMeta", { owner, due });
                    return (
                      <li key={key} className="flex items-start gap-2.5">
                        <Checkbox
                          checked={done}
                          disabled={actionsDisabled}
                          onCheckedChange={(checked) =>
                            onActionItemToggle(
                              artifact.artifact_id,
                              index,
                              checked === true,
                            )
                          }
                          aria-label={t(
                            "meetings.review.actionDone",
                            "Mark this action item done",
                          )}
                          /* Centred on the first line of the text beside it, not
                           * on the block: a two-line item keeps its box on the
                           * line that names the work. */
                          className="mt-0.5"
                        />
                        <div
                          className={cn(
                            "flex min-w-0 flex-1 flex-col gap-1",
                            done ? "opacity-60" : "",
                          )}
                        >
                          <CitedText
                            value={action.text}
                            onJump={onJump}
                            className={done ? "line-through" : undefined}
                          />
                          {/* Whoever owns it and when it is due, and neither of
                           * them printed as an absence: "Owner: Unassigned ·
                           * Due: No due date" was two facts nobody recorded,
                           * stated as if they had been. */}
                          {meta === null ? null : (
                            <span className={META}>{meta}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </ArtifactSection>
            )}

            {content.key_questions.length === 0 ? null : (
              <ArtifactSection label={t("meetings.review.keyQuestions")}>
                <ul role="list" className="flex flex-col gap-4">
                  {content.key_questions.map((item, index) => (
                    <li key={`${artifact.artifact_id}:question:${index}`}>
                      <CitedText value={item} onJump={onJump} />
                    </li>
                  ))}
                </ul>
              </ArtifactSection>
            )}

            {content.risks.length === 0 ? null : (
              <ArtifactSection label={t("meetings.review.risks")}>
                <ul role="list" className="flex flex-col gap-4">
                  {content.risks.map((item, index) => (
                    <li key={`${artifact.artifact_id}:risk:${index}`}>
                      <CitedText value={item} onJump={onJump} />
                    </li>
                  ))}
                </ul>
              </ArtifactSection>
            )}

            <ArtifactSection label={t("meetings.review.followUp")}>
              <CitedText value={content.follow_up_draft} onJump={onJump} />
            </ArtifactSection>
          </>
        )}
      </div>
    </article>
  );
};

interface ArtifactSectionProps {
  label: string;
  children: React.ReactNode;
}

const ArtifactSection: React.FC<ArtifactSectionProps> = ({
  label,
  children,
}) => (
  <section className="flex flex-col gap-2">
    <h4>
      <Microlabel>{label}</Microlabel>
    </h4>
    {children}
  </section>
);
