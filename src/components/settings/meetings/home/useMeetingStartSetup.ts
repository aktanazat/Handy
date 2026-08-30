import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import type { SourceKind } from "@/bindings";
import type { MeetingStartOptions } from "../meetingTypes";

const DEFAULT_MEETING_SOURCES: SourceKind[] = ["microphone", "system_audio"];

/** Fills in everything a press of Start records that the press itself does not
 *  say: the sources on the page, and the defaults that never change. */
export type MeetingStartOptionsBuilder = (
  origin: MeetingStartOptions["origin"],
  suggestionId?: MeetingStartOptions["suggestionId"],
  title?: string,
  preview?: MeetingStartOptions["preview"],
) => MeetingStartOptions;

export interface MeetingStartSetup {
  sources: SourceKind[];
  setSources: Dispatch<SetStateAction<SourceKind[]>>;
  startOptions: MeetingStartOptionsBuilder;
}

export const useMeetingStartSetup = (): MeetingStartSetup => {
  const { t } = useTranslation();
  /* What the next press of Start will record. Sources are the only part of
   * setup a person changes often enough to keep on the page. */
  const [sources, setSources] = useState<SourceKind[]>(DEFAULT_MEETING_SOURCES);

  const startOptions = useCallback(
    (
      origin: MeetingStartOptions["origin"],
      suggestionId: MeetingStartOptions["suggestionId"] = null,
      title = t("meetings.setup.defaultTitle"),
      preview: MeetingStartOptions["preview"] = null,
    ): MeetingStartOptions => ({
      title,
      origin,
      suggestionId,
      sources,
      degradedStartPolicy: "abort_if_required_source_fails",
      destination: { kind: "local" },
      preview,
    }),
    [sources, t],
  );

  return { sources, setSources, startOptions };
};
