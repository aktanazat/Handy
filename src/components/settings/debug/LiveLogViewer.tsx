import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { SettingsField } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { ScrollArea } from "@/components/vg/scroll-area";

// Maximum number of lines kept in memory / rendered at once.
const MAX_LINES = 1000;
// Incoming logs are buffered and flushed on this cadence so a burst of log
// activity can never trigger a render per line.
const FLUSH_INTERVAL_MS = 250;
// How close to the bottom still counts as "following the tail".
const PIN_SLACK_PX = 24;

// Payload emitted by tauri-plugin-log's `Webview` target on the `log://log`
// event. `level` is the numeric LogLevel repr: Trace=1, Debug=2, Info=3,
// Warn=4, Error=5. `message` is the raw log message (no timestamp/target).
interface LogEventPayload {
  message: string;
  level: number;
}

interface LogLine {
  id: number;
  level: number;
  time: string;
  message: string;
}

interface LogLevelMeta {
  tag: string;
  tagClass: string;
  msgClass: string;
}

/** The numeric `level` reprs tauri-plugin-log emits, per `LogEventPayload`. */
type LogLevelRepr = 1 | 2 | 3 | 4 | 5;

/* Levels stay in the grey ladder, and only warnings and errors get a hue.
 * `satisfies` keeps this exhaustive over `LogLevelRepr` while leaving the keys
 * literal, so the lookup below is total without an index signature. */
const LEVEL_META = {
  1: {
    tag: "Trace",
    tagClass: "text-gray-700",
    msgClass: "text-gray-700",
  },
  2: {
    tag: "Debug",
    tagClass: "text-gray-700",
    msgClass: "text-gray-900",
  },
  3: {
    tag: "Info",
    tagClass: "text-gray-800",
    msgClass: "text-gray-1000",
  },
  4: {
    tag: "Warn",
    tagClass: "text-amber-900",
    msgClass: "text-gray-1000",
  },
  5: {
    tag: "Error",
    tagClass: "text-red-900",
    msgClass: "text-red-900",
  },
} satisfies Record<LogLevelRepr, LogLevelMeta>;

const UNKNOWN_META: LogLevelMeta = {
  tag: "Log",
  tagClass: "text-gray-700",
  msgClass: "text-gray-1000",
};

/* `level` is a bare number off the event payload, so it is decoded against the
 * known reprs rather than indexed blind or asserted into one. */
const isLogLevelRepr = (level: number): level is LogLevelRepr =>
  level === 1 || level === 2 || level === 3 || level === 4 || level === 5;

const metaFor = (level: number): LogLevelMeta =>
  isLogLevelRepr(level) ? LEVEL_META[level] : UNKNOWN_META;

const formatTime = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
};

export const LiveLogViewer: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);

  const pendingRef = useRef<LogLine[]>([]);
  const idRef = useRef(0);
  const pausedRef = useRef(false);
  const pinnedRef = useRef(true);
  const viewportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  /* Radix scrolls its viewport, not its root, and the kit renders that viewport
   * itself — so the scroller is resolved from the root by its data-slot rather
   * than through a prop the kit does not expose. */
  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current =
      node?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ??
      null;
  }, []);

  // Subscribe to the backend log stream. Lines land in a ref buffer rather than
  // state so high log volume never overwhelms React.
  useEffect(() => {
    const unlisten = listen<LogEventPayload>("log://log", (event) => {
      const line: LogLine = {
        id: idRef.current++,
        level: event.payload.level,
        time: formatTime(new Date()),
        message: event.payload.message,
      };
      const pending = pendingRef.current;
      pending.push(line);
      if (pending.length > MAX_LINES) {
        pending.splice(0, pending.length - MAX_LINES);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Flush buffered lines into state on a fixed cadence to cap re-renders.
  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current || pendingRef.current.length === 0) return;
      const incoming = pendingRef.current;
      pendingRef.current = [];
      setLogs((prev) => {
        const next = prev.concat(incoming);
        return next.length > MAX_LINES
          ? next.slice(next.length - MAX_LINES)
          : next;
      });
    }, FLUSH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  /* Reading the scroll offset on a native listener keeps the tail-following
   * flag off React's synthetic path: `scroll` does not bubble, and the element
   * that fires it is inside the kit's markup. */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleScroll = () => {
      pinnedRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK_PX;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Keep the view pinned to the latest line unless the user has scrolled up.
  useEffect(() => {
    const el = viewportRef.current;
    if (pinnedRef.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  const handleClear = useCallback(() => {
    pendingRef.current = [];
    setLogs([]);
    pinnedRef.current = true;
  }, []);

  const handleCopy = useCallback(async () => {
    const text = logs
      .map((l) => `${l.time} ${metaFor(l.level).tag} ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy logs:", error);
    }
  }, [logs]);

  return (
    <SettingsField
      label={t("settings.debug.liveLogs.title")}
      hint={t("settings.debug.liveLogs.description")}
      fact={t("settings.debug.liveLogs.lineCount", { count: logs.length })}
    >
      {/* Whether the stream is running is printed once, by the button that
       * changes it: "Pause" can only mean it is live. */}
      <div className="mb-2 flex items-center justify-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaused((p) => !p)}
        >
          {paused
            ? t("settings.debug.liveLogs.resume")
            : t("settings.debug.liveLogs.pause")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleCopy()}
          disabled={logs.length === 0}
        >
          {copied ? t("settings.debug.liveLogs.copied") : t("common.copy")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={logs.length === 0}
        >
          {t("common.clear")}
        </Button>
      </div>

      <ScrollArea
        ref={attachRoot}
        className="h-72 rounded-md border border-gray-alpha-400 bg-background-200"
      >
        <div className="select-text p-2 text-[11px] leading-[18px] tabular-nums">
          {logs.length === 0 ? (
            <span className="text-gray-700 select-none">
              {t("settings.debug.liveLogs.empty")}
            </span>
          ) : (
            logs.map((line) => {
              const meta = metaFor(line.level);
              return (
                <div key={line.id} className="flex gap-2">
                  <span className="shrink-0 text-gray-700 tabular-nums select-none">
                    {line.time}
                  </span>
                  {/* The fixed column keeps every sentence-case tag aligned. */}
                  <span
                    className={`${meta.tagClass} w-[49px] shrink-0 select-none`}
                  >
                    {meta.tag}
                  </span>
                  <span
                    className={`${meta.msgClass} min-w-0 break-words whitespace-pre-wrap`}
                  >
                    {line.message}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </SettingsField>
  );
};
