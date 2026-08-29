import type {
  DegradedStartPolicy,
  MeetingOrigin,
  MeetingSuggestionId,
  ProcessingDestination,
  SourceKind,
} from "@/bindings";

/** Everything one press of Start needs. There is no setup screen: these are
 *  the defaults the start block shows inline and can flip in place. */
export interface MeetingStartOptions {
  title: string;
  origin: MeetingOrigin;
  suggestionId: MeetingSuggestionId | null;
  sources: SourceKind[];
  degradedStartPolicy: DegradedStartPolicy;
  destination: ProcessingDestination;
}

export type MeetingScreen =
  | { kind: "home" }
  /** A session exists but capture has not begun: the start attempt hit an
   *  unavailable source, or a preflight session was opened from elsewhere. */
  | { kind: "gate"; sessionId: string; options: MeetingStartOptions }
  | { kind: "session"; sessionId: string };
