import type {
  DegradedStartPolicy,
  MeetingOrigin,
  MeetingSuggestionId,
  ProcessingDestination,
  SourceKind,
} from "@/bindings";
import type { MeetingPreviewFacts } from "./MeetingPreviewCard";

/** Everything one press of Start needs. There is no setup screen: these are
 *  the defaults the start block shows inline and can flip in place. */
export interface MeetingStartOptions {
  title: string;
  origin: MeetingOrigin;
  suggestionId: MeetingSuggestionId | null;
  sources: SourceKind[];
  degradedStartPolicy: DegradedStartPolicy;
  destination: ProcessingDestination;
  /** What the operator was looking at when they pressed Start, so the
   * preflight can show the same meeting rather than a bare title. `null` for
   * a start with no preview behind it, which is the manual press. */
  preview: MeetingPreviewFacts | null;
}

export type MeetingScreen =
  | { kind: "home" }
  /** A session exists but capture has not begun: the start attempt hit an
   *  unavailable source, or a preflight session was opened from elsewhere. */
  | { kind: "gate"; sessionId: string; options: MeetingStartOptions }
  | { kind: "session"; sessionId: string };
