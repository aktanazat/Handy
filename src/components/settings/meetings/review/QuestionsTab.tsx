import React from "react";
import { useTranslation } from "react-i18next";
import type { MeetingAnswerState, MeetingReviewSnapshot } from "@/bindings";
import {
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Textarea } from "@/components/vg/textarea";
import { AnswerCitations } from "./Citations";

const ANSWER_STATE_CLASSES = {
  supported: "text-gray-700",
  insufficient_evidence: "text-amber-900",
  unavailable: "text-amber-900",
  out_of_date: "text-amber-900",
  forgotten: "text-gray-700",
} as const satisfies Record<MeetingAnswerState, string>;

export interface QuestionsTabProps {
  snapshot: MeetingReviewSnapshot;
  canAskQuestion: boolean;
  question: string;
  askingQuestion: boolean;
  onQuestionChange: (value: string) => void;
  onAskQuestion: () => void;
  onForgetQuestion: (questionId: string) => void;
  onJumpToSegment: (segmentId: string) => void;
}

export const QuestionsTab: React.FC<QuestionsTabProps> = ({
  snapshot,
  canAskQuestion,
  question,
  askingQuestion,
  onQuestionChange,
  onAskQuestion,
  onForgetQuestion,
  onJumpToSegment,
}) => {
  const { t } = useTranslation();

  return (
    <SettingsSection label={t("meetings.review.questions")}>
      <div className="flex flex-col gap-2 p-4">
        {/* The one sentence this surface keeps: where the answer comes from
         * is not inferable from a text box and a button. */}
        <p className="text-sm text-gray-700">
          {t("meetings.review.questionsDescription")}
        </p>
        <Textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder={t("meetings.review.questionPlaceholder")}
          aria-label={t("meetings.review.questions")}
          disabled={!canAskQuestion || askingQuestion}
          rows={2}
          className="resize-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Notice tone="muted">
            {!canAskQuestion
              ? t(
                  "meetings.review.askUnavailable",
                  "Asking needs a finished local transcript.",
                )
              : askingQuestion
                ? t("meetings.review.asking", "Asking this meeting…")
                : null}
          </Notice>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ms-auto"
            onClick={onAskQuestion}
            disabled={
              !canAskQuestion || askingQuestion || question.trim().length === 0
            }
          >
            {t("meetings.review.ask")}
          </Button>
        </div>
      </div>

      {snapshot.questions.length === 0 ? (
        <div className="px-4 py-3">
          <Notice tone="muted" live={false}>
            {t("meetings.review.noQuestions")}
          </Notice>
        </div>
      ) : (
        <ul
          role="list"
          aria-label={t("meetings.review.questions")}
          className="divide-y divide-gray-alpha-400"
        >
          {snapshot.questions.map((answer) => (
            <li
              key={`${answer.question_id}:${answer.revision}`}
              className="flex flex-col gap-3 px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Microlabel>
                    {t("meetings.review.youAsked", "You asked")}
                  </Microlabel>
                  <span
                    className={`flex-none font-mono text-[11px] ${ANSWER_STATE_CLASSES[answer.state]}`}
                  >
                    {t(`meetings.answerState.${answer.state}`)}
                  </span>
                </div>
                <p className="text-[13px] leading-5 font-medium text-pretty text-gray-1000">
                  {answer.question ?? t("meetings.review.question")}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Microlabel>
                  {t("meetings.review.sonaAnswered", "Sona answered")}
                </Microlabel>
                <p className="text-[13px] leading-5 text-pretty text-gray-900">
                  {answer.answer ?? t("meetings.review.insufficientEvidence")}
                </p>
                {answer.citations.length > 0 ? (
                  <AnswerCitations
                    citations={answer.citations}
                    onJump={onJumpToSegment}
                  />
                ) : null}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onForgetQuestion(answer.question_id)}
                    disabled={askingQuestion || answer.state === "forgotten"}
                  >
                    {t("meetings.review.forget")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
};
