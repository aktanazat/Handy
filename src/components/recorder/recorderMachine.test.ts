import { describe, expect, test } from "bun:test";
import type { RecorderPreflight, RecorderSnapshot } from "@/bindings";
import {
  canCloseRecorder,
  initialRecorderState,
  recorderCommandErrorFallback,
  recorderHasCapture,
  recorderReducer,
} from "./recorderMachine";

const snapshot = (
  overrides: Partial<RecorderSnapshot> = {},
): RecorderSnapshot => ({
  phase: "idle",
  elapsedMs: 0,
  screenSelected: false,
  droppedVideoFrames: 0,
  outputPath: null,
  width: null,
  height: null,
  failure: null,
  ...overrides,
});

describe("recorderMachine", () => {
  test("returns a cancelled native source picker to setup with input choices intact", () => {
    const preflight = {
      availability: "supported",
      startAvailability: "ready",
      cameraDevices: [{ id: "camera-1", name: "Continuity Camera" }],
      microphoneDevices: [{ id: "microphone-1", name: "Studio Microphone" }],
    } satisfies RecorderPreflight;
    const ready = recorderReducer(initialRecorderState(), {
      type: "preflight",
      preflight,
    });
    const next = recorderReducer(ready, {
      type: "snapshot",
      snapshot: snapshot({
        phase: "failed",
        screenSelected: true,
        failure: "sourceSelectionCancelled",
      }),
    });

    expect(next.snapshot.phase).toBe("idle");
    expect(next.snapshot.failure).toBeNull();
    expect(next.snapshot.screenSelected).toBe(false);
    expect(next.preflight?.cameraDevices).toEqual(preflight.cameraDevices);
    expect(next.preflight?.microphoneDevices).toEqual(
      preflight.microphoneDevices,
    );
  });

  test("keeps another Sona capture isolated behind the capture-busy state", () => {
    const preflight = {
      availability: "supported",
      startAvailability: "captureBusy",
      cameraDevices: [],
      microphoneDevices: [],
    } satisfies RecorderPreflight;
    const next = recorderReducer(initialRecorderState(), {
      type: "preflight",
      preflight,
    });

    expect(next.snapshot.phase).toBe("failed");
    expect(next.snapshot.failure).toBe("captureBusy");
  });

  test("keeps the native elapsed value fixed when a recording pauses", () => {
    const next = recorderReducer(initialRecorderState(), {
      type: "snapshot",
      snapshot: snapshot({
        phase: "paused",
        elapsedMs: 25_000,
        screenSelected: true,
      }),
    });

    expect(next.snapshot.elapsedMs).toBe(25_000);
    expect(next.snapshot.phase).toBe("paused");
  });

  test("keeps a saved file visible when folder reveal fails", () => {
    const saved = recorderReducer(initialRecorderState(), {
      type: "snapshot",
      snapshot: snapshot({
        phase: "saved",
        elapsedMs: 25_000,
        screenSelected: true,
        outputPath: "/recordings/sona-screen.mp4",
        width: 1920,
        height: 1080,
      }),
    });
    const next = recorderReducer(saved, { type: "reveal-failed" });

    expect(next.snapshot.phase).toBe("saved");
    expect(next.snapshot.outputPath).toBe("/recordings/sona-screen.mp4");
    expect(next.revealFailed).toBe(true);
  });

  test("keeps native finalization and source selection non-dismissible", () => {
    const finalizing = recorderReducer(initialRecorderState(), {
      type: "snapshot",
      snapshot: snapshot({
        phase: "finalizing",
        elapsedMs: 25_000,
        screenSelected: true,
      }),
    });

    expect(finalizing.snapshot.elapsedMs).toBe(25_000);
    expect(canCloseRecorder(finalizing.snapshot.phase)).toBe(false);
    expect(canCloseRecorder("selectingSource")).toBe(false);
    expect(canCloseRecorder("starting")).toBe(false);
    expect(canCloseRecorder("recording")).toBe(false);
    expect(canCloseRecorder("paused")).toBe(false);
    expect(canCloseRecorder("checking")).toBe(true);
    expect(canCloseRecorder("permission")).toBe(true);
    expect(canCloseRecorder("idle")).toBe(true);
    expect(canCloseRecorder("previewing")).toBe(true);
    expect(canCloseRecorder("saved")).toBe(true);
    expect(canCloseRecorder("failed")).toBe(true);
  });

  test("keeps an event-delivered native snapshot after a later invalid-state command result", () => {
    const finalizing = recorderReducer(initialRecorderState(), {
      type: "phase",
      phase: "finalizing",
    });
    const afterNativeEvent = recorderReducer(finalizing, {
      type: "snapshot",
      snapshot: snapshot({
        phase: "permission",
        failure: "cameraPermissionDenied",
      }),
    });
    const fallback = recorderCommandErrorFallback(afterNativeEvent.snapshot);
    const afterCommandResult =
      fallback === null
        ? afterNativeEvent
        : recorderReducer(afterNativeEvent, {
            type: "failure",
            failure: fallback,
          });

    expect(afterCommandResult.snapshot.phase).toBe("permission");
    expect(afterCommandResult.snapshot.failure).toBe("cameraPermissionDenied");
    expect(
      recorderCommandErrorFallback(
        snapshot({ phase: "failed", failure: "outputFinalizeFailed" }),
      ),
    ).toBeNull();
    expect(recorderCommandErrorFallback(null)).toBe("streamFailed");
  });

  test("names the denied permission the native snapshot reports", () => {
    /* Every permission code reaches the frontend as the permission phase with
     * the denied code attached, so this is the shape a camera denial arrives
     * in — not a failed phase. */
    const cameraDenied = recorderReducer(initialRecorderState(), {
      type: "snapshot",
      snapshot: snapshot({
        phase: "permission",
        failure: "cameraPermissionDenied",
      }),
    });

    expect(cameraDenied.snapshot.phase).toBe("permission");
    expect(cameraDenied.permission).toBe("camera");
    expect(cameraDenied.permissionRequested).toBe(false);

    const microphoneDenied = recorderReducer(initialRecorderState(), {
      type: "snapshot",
      snapshot: snapshot({
        phase: "permission",
        failure: "microphonePermissionDenied",
      }),
    });

    expect(microphoneDenied.permission).toBe("microphone");

    const rechecking = recorderReducer(cameraDenied, {
      type: "permission",
      permission: "camera",
      requested: true,
    });

    expect(rechecking.snapshot.phase).toBe("permission");
    expect(rechecking.permission).toBe("camera");
    expect(rechecking.permissionRequested).toBe(true);
  });

  test("reports capture for every phase that owns a native stream", () => {
    const phases = [
      "checking",
      "permission",
      "idle",
      "selectingSource",
      "previewing",
      "starting",
      "recording",
      "paused",
      "finalizing",
      "saved",
      "failed",
    ] as const;
    const capture = Object.fromEntries(
      phases.map((phase) => [phase, recorderHasCapture(snapshot({ phase }))]),
    );

    expect(capture).toEqual({
      checking: false,
      permission: false,
      idle: false,
      selectingSource: false,
      previewing: true,
      starting: true,
      recording: true,
      paused: true,
      finalizing: true,
      saved: true,
      failed: false,
    });
    /* A chosen screen is capture the phase alone does not report: the picker
     * has already handed the app a source. */
    expect(
      recorderHasCapture(snapshot({ phase: "idle", screenSelected: true })),
    ).toBe(true);
  });
});
