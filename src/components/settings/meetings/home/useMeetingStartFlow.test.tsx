import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import {
  commands,
  type MeetingPreflightCreateRequest,
  type MeetingReviewSnapshot,
  type MeetingStartRequest,
} from "@/bindings";
import { consentFor } from "../MeetingStartGate";
import type { MeetingStartOptions } from "../meetingTypes";
import {
  type MeetingStartFlow,
  useMeetingStartFlow,
} from "./useMeetingStartFlow";
import type { MeetingWorkflow } from "./useMeetingWorkflow";

interface FlowCapture {
  flow: MeetingStartFlow | null;
}

const i18n = createInstance();
void i18n.init({
  lng: "en",
  resources: {
    en: { translation: { meetings: { errors: { operation: "Try again" } } } },
  },
  interpolation: { escapeValue: false },
});

const workflow: MeetingWorkflow = {
  state: {
    screen: { kind: "home" },
    snapshot: null,
    pendingAction: null,
  },
  transitions: {
    showHome: () => {},
    showSession: () => {},
    showLoadedSession: () => {},
    showGate: () => {},
    beginAction: () => {},
    finishAction: () => {},
    openSession: async () => {},
    refreshSessionAndHome: async () => {},
  },
};

const PREFLIGHT: MeetingReviewSnapshot = {
  session: {
    session_id: "meeting-partial",
    phase: "preflight",
    revision: 3,
    title: "Design review",
    started_at_utc_ms: null,
    elapsed_offset_ns: null,
    sources: [
      {
        track_id: null,
        source_kind: "microphone",
        required: true,
        availability: "available",
        health: "not_started",
        format: null,
        last_durable_offset_ns: null,
        gap_count: 0,
      },
      {
        track_id: null,
        source_kind: "system_audio",
        required: true,
        availability: "permission_denied",
        health: "not_started",
        format: null,
        last_durable_offset_ns: null,
        gap_count: 0,
      },
    ],
    open_capture_window_started_at_ns: null,
    capture_completeness: "not_started",
    storage: "available",
    processing_status: { kind: "pending" },
    preflight_local_processing: "available",
    retention_deadline_utc_ms: null,
    allowed_actions: ["refresh_preflight", "cancel_preflight", "start"],
  },
  tracks: [],
  gaps: [],
  speakers: [],
  transcript: [],
  notes: [],
  artifacts: [],
  questions: [],
  diarization: {
    status: "not_requested",
    model_id: "diarizer",
    model_version: "1",
    generation_id: null,
    assigned_segment_count: 0,
  },
  can_export: false,
  remote_cancellation_pending: false,
};

describe("useMeetingStartFlow", () => {
  test("sends the exact countdown calendar event key to preflight", async () => {
    const originalPreflight = commands.meetingPreflightCreate;
    const requests = new Array<MeetingPreflightCreateRequest>();
    commands.meetingPreflightCreate = async (request) => {
      requests.push(request);
      return { status: "error", error: "invalid_request" };
    };
    const captured: FlowCapture = { flow: null };

    const Harness = () => {
      captured.flow = useMeetingStartFlow({
        workflow,
        refreshHome: async () => {},
        receiveReceipt: () => false,
        reportMeetingError: () => {},
      });
      return null;
    };

    renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>,
    );

    const options: MeetingStartOptions = {
      title: "Design review",
      origin: "manual",
      suggestionId: null,
      calendarEventKey: "calendar:event:stable-key",
      sources: ["microphone"],
      degradedStartPolicy: "abort_if_required_source_fails",
      destination: { kind: "local" },
      preview: null,
    };
    const flow = captured.flow;
    if (flow === null) throw new Error("meeting start flow did not render");

    try {
      await flow.startMeeting(options);
      expect(requests.length).toBe(1);
      expect(requests[0]?.title).toBe("Design review");
      expect(requests[0]?.origin).toBe("manual");
      expect(requests[0]?.calendar_event_key).toBe("calendar:event:stable-key");
    } finally {
      commands.meetingPreflightCreate = originalPreflight;
    }
  });

  test("carries the gate's acknowledged missing source into the start request", async () => {
    const originalStart = commands.meetingStart;
    const requests = new Array<MeetingStartRequest>();
    commands.meetingStart = async (request) => {
      requests.push(request);
      return { status: "error", error: "invalid_request" };
    };
    const captured: FlowCapture = { flow: null };
    const gateWorkflow: MeetingWorkflow = {
      ...workflow,
      state: { ...workflow.state, snapshot: PREFLIGHT },
    };

    const Harness = () => {
      captured.flow = useMeetingStartFlow({
        workflow: gateWorkflow,
        refreshHome: async () => {},
        receiveReceipt: () => false,
        reportMeetingError: () => {},
      });
      return null;
    };

    renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>,
    );

    const options: MeetingStartOptions = {
      title: "Design review",
      origin: "manual",
      suggestionId: null,
      calendarEventKey: null,
      sources: ["microphone", "system_audio"],
      degradedStartPolicy: "abort_if_required_source_fails",
      destination: { kind: "local" },
      preview: null,
    };
    const flow = captured.flow;
    if (flow === null) throw new Error("meeting start flow did not render");

    try {
      await flow.startFromGate(consentFor(options, ["system_audio"], true));
      expect(requests.length).toBe(1);
      expect(requests[0]?.session_id).toBe("meeting-partial");
      expect(requests[0]?.expected_revision).toBe(3);
      expect(requests[0]?.consent.known_missing_sources_acknowledged).toEqual([
        "system_audio",
      ]);
      expect(requests[0]?.consent.degraded_start_policy).toBe(
        "continue_and_mark_partial",
      );
    } finally {
      commands.meetingStart = originalStart;
    }
  });
});
