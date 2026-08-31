import React from "react";
import { useTranslation } from "react-i18next";
import type { MeetingArtifactRevision, MeetingArtifactState } from "@/bindings";
import { Microlabel, Notice } from "@/components/settings/rows";
import { Checkbox } from "@/components/vg/checkbox";
import { actionItemKey } from "../meetingAnalytics";
import { CitedText } from "./Citations";

const ARTIFACT_STATE_CLASSES = {
  current: "text-gray-700",
  out_of_date: "text-amber-900",
  failed: "text-red-900",
} as const satisfies Record<MeetingArtifactState, string>;

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

  return (
    <article className="flex flex-col gap-4 px-4 py-4">
      {/* The template names the artifact; the state word answers the only
       * question the version and source revision were there to answer, and
       * answered it in the same breath as a second "Template". */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 text-[13px] leading-5 font-medium text-gray-1000">
          {t("meetings.review.template", { template: artifact.template_id })}
        </h3>
        <span
          className={`flex-none text-[11px] ${ARTIFACT_STATE_CLASSES[artifact.state]}`}
        >
          {t(`meetings.artifactState.${artifact.state}`)}
        </span>
      </header>
      {content === null ? (
        <Notice tone="muted" live={false}>
          {t("meetings.review.artifactUnavailable")}
        </Notice>
      ) : (
        <>
          <ArtifactBlock title={t("meetings.review.summary")}>
            <CitedText value={content.summary} onJump={onJump} />
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.topics")}>
            {content.outline.length === 0 ? (
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {content.outline.map((topic, index) => (
                  <li key={`${artifact.artifact_id}:topic:${index}`}>
                    <CitedText value={topic.title} onJump={onJump} />
                    {topic.detail ? (
                      <div className="mt-1 ps-3">
                        <CitedText value={topic.detail} onJump={onJump} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.decisions")}>
            {content.decisions.length === 0 ? (
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {content.decisions.map((decision, index) => (
                  <li key={`${artifact.artifact_id}:decision:${index}`}>
                    <CitedText value={decision} onJump={onJump} />
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.actions")}>
            {content.action_items.length === 0 ? (
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {content.action_items.map((action, index) => {
                  const key = actionItemKey(artifact.artifact_id, index);
                  const done = doneActionItems.has(key);
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
                        className="mt-1"
                      />
                      <div
                        className={`min-w-0 flex-1 ${done ? "line-through opacity-60" : ""}`}
                      >
                        <CitedText value={action.text} onJump={onJump} />
                        {/* The owner is somebody's name, so it stays in normal
                         * sentence-case text. */}
                        <span className="mt-0.5 block text-[11px] text-gray-700">
                          {t("meetings.review.actionMeta", {
                            owner:
                              action.owner_text ??
                              t("meetings.review.unassigned"),
                            due:
                              action.due_text ?? t("meetings.review.noDueDate"),
                          })}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.keyQuestions")}>
            {content.key_questions.length === 0 ? (
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {content.key_questions.map((item, index) => (
                  <li key={`${artifact.artifact_id}:question:${index}`}>
                    <CitedText value={item} onJump={onJump} />
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.risks")}>
            {content.risks.length === 0 ? (
              <EmptyBlock />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {content.risks.map((item, index) => (
                  <li key={`${artifact.artifact_id}:risk:${index}`}>
                    <CitedText value={item} onJump={onJump} />
                  </li>
                ))}
              </ul>
            )}
          </ArtifactBlock>
          <ArtifactBlock title={t("meetings.review.followUp")}>
            <CitedText value={content.follow_up_draft} onJump={onJump} />
          </ArtifactBlock>
        </>
      )}
    </article>
  );
};

/** A generated block the model returned nothing for. */
const EmptyBlock: React.FC = () => {
  const { t } = useTranslation();

  return (
    <span className="text-sm text-gray-700">{t("meetings.review.none")}</span>
  );
};

interface ArtifactBlockProps {
  title: string;
  children: React.ReactNode;
}

const ArtifactBlock: React.FC<ArtifactBlockProps> = ({ title, children }) => (
  <section className="flex flex-col gap-1.5">
    <h4>
      <Microlabel>{title}</Microlabel>
    </h4>
    {children}
  </section>
);
