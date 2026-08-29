import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type {
  StreamEngine,
  StreamPhase,
  StreamTextEvent,
  StreamWorkKind,
} from "@/bindings";
import type { LanguageDirection } from "@/lib/utils/rtl";
import type { OverlayState } from "./overlayEvents";
import { HudPill } from "./HudPill";

interface RecordingOverlayContentProps {
  isVisible: boolean;
  state: OverlayState;
  captureReady: boolean;
  levels: number[];
  streamText: StreamTextEvent;
  phase: StreamPhase;
  workKind: StreamWorkKind;
  engine: StreamEngine;
  elapsed: number;
  session: number;
  position: "top" | "bottom";
  overflowing: boolean;
  direction: LanguageDirection;
  capRef: RefObject<HTMLDivElement>;
  onStreamScroll: () => void;
}

const formatElapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export const RecordingOverlayContent = ({
  isVisible,
  state,
  captureReady,
  levels,
  streamText,
  phase,
  workKind,
  engine,
  elapsed,
  session,
  position,
  overflowing,
  direction,
  capRef,
  onStreamScroll,
}: RecordingOverlayContentProps) => {
  const { t } = useTranslation();

  if (!isVisible) return null;

  if (state === "idle") {
    return <HudPill position={position} direction={direction} />;
  }

  const waveform = (
    <div className={`swave ${captureReady ? "ready" : "arming"}`}>
      {levels.map((level, index) => (
        <i
          key={index}
          style={{
            height: `${Math.max(3, Math.min(18, 3 + Math.pow(level, 0.7) * 15))}px`,
          }}
        />
      ))}
    </div>
  );

  const cancelButton = (
    <button
      className="sx"
      aria-label={t("common.cancel")}
      onClick={() => commands.cancelOperation()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 4 L12 12 M12 4 L4 12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  const engineStatus =
    engine === "cloud"
      ? { label: t("overlay.cloud"), className: "cloud" }
      : engine === "local_fallback"
        ? { label: t("overlay.localFallback"), className: "fallback" }
        : null;
  const engineClass = engineStatus ? `engine-${engineStatus.className}` : "";
  const engineBadge = engineStatus ? (
    <span
      className={`sengine ${engineStatus.className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {engineStatus.label}
    </span>
  ) : null;

  const listeningRow = (showTimer: boolean, showCancel: boolean) => (
    <div className="sbase">
      <div className="sbase-l">
        <span className={`sdot ${captureReady ? "ready" : "arming"}`} />
      </div>
      {waveform}
      <div className="sbase-r">
        {engineBadge}
        {showTimer && <span className="stimer">{formatElapsed(elapsed)}</span>}
        {showCancel && cancelButton}
      </div>
    </div>
  );

  const workingRow = (label: string, showCancel: boolean) => (
    <div className="sbase">
      <div className="sbase-l">
        <span className="sspinner" />
      </div>
      <div className="swork-content">
        <span className="swork-label">{label}</span>
        {engineBadge}
      </div>
      <div className="sbase-r">{showCancel && cancelButton}</div>
    </div>
  );

  if (state === "streaming") {
    const hasText =
      streamText.committed.length > 0 || streamText.tentative.length > 0;
    const working = phase === "working";
    const open = hasText;
    const collapsed = working && !hasText;

    return (
      <div dir={direction} className={`ov-stage ${position}`}>
        <div
          key={session}
          className={[
            "scard",
            open && "open",
            collapsed && "working",
            engineClass,
            !isVisible && "leaving",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="stext">
            <div className="stext-clip">
              <div
                className={`stext-cap ${overflowing ? "overflowing" : ""}`}
                ref={capRef}
                onScroll={onStreamScroll}
              >
                <p>
                  <span className="committed">
                    {streamText.committed ? `${streamText.committed} ` : ""}
                  </span>
                  <span className="tentative">{streamText.tentative}</span>
                  {!working && <span className="scaret" />}
                </p>
              </div>
            </div>
          </div>
          {working
            ? workingRow(
                workKind === "polishing"
                  ? t("overlay.processing")
                  : t("overlay.transcribing"),
                true,
              )
            : listeningRow(open, true)}
        </div>
      </div>
    );
  }

  const working = state === "transcribing" || state === "processing";
  const workLabel =
    state === "processing"
      ? t("overlay.processing")
      : t("overlay.transcribing");

  return (
    <div
      dir={direction}
      className={`ov-stage ${position} ov-fade ${isVisible ? "show" : ""}`}
    >
      <div
        className={[
          "scard",
          "compact",
          working && isVisible && "cworking",
          engineClass,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {working ? workingRow(workLabel, true) : listeningRow(false, true)}
      </div>
    </div>
  );
};
