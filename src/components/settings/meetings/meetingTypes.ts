import type {
  DegradedStartPolicy,
  MeetingOrigin,
  MeetingSuggestionId,
  ProcessingDestination,
  SourceKind,
} from "@/bindings";

export interface MeetingPreflightDraft {
  title: string;
  origin: MeetingOrigin;
  suggestionId: MeetingSuggestionId | null;
  requestedSources: SourceKind[];
  requiredSources: SourceKind[];
  acceptedKnownMissingSources: SourceKind[];
  degradedStartPolicy: DegradedStartPolicy;
  destination: ProcessingDestination;
}

export type MeetingScreen =
  | { kind: "home" }
  | { kind: "draft"; draft: MeetingPreflightDraft }
  | {
      kind: "preflight";
      sessionId: string;
      draft: MeetingPreflightDraft;
    }
  | { kind: "session"; sessionId: string };
