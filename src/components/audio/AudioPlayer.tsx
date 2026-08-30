import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Play, Pause } from "lucide-react";
import { formatDurationShort } from "@/lib/utils/format";

export interface AudioPlayerProps {
  /** Audio source URL. If not provided, onLoadRequest must be provided. */
  src?: string;
  /** Called when play is clicked and no src is loaded yet. Should return the audio URL. */
  onLoadRequest?: () => Promise<string | null>;
  /**
   * Length the caller already knows, in seconds, before the media element has
   * read its own metadata. Without it the total reads 0s next to an elapsed
   * 0s — one measurement printed twice, neither of them true. A caller that
   * genuinely does not know the length omits it and the total reads as
   * unknown until the file loads.
   */
  totalSeconds?: number;
  className?: string;
  autoPlay?: boolean;
}

interface AudioPlayerGroupContextValue {
  requestPlayback: (audio: HTMLAudioElement) => void;
  releasePlayback: (audio: HTMLAudioElement) => void;
}

const AudioPlayerGroupContext =
  createContext<AudioPlayerGroupContextValue | null>(null);

/* The scrubber's two readouts go through the app's one duration renderer, so
 * "3m 12s" here and "3m 12s" on the row above it are the same string produced
 * by the same function. */
const readout = (seconds: number): string =>
  Number.isFinite(seconds) ? formatDurationShort(seconds) : "—";

export const AudioPlayerGroup: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const value = useMemo<AudioPlayerGroupContextValue>(
    () => ({
      requestPlayback: (audio) => {
        if (activeAudioRef.current !== audio) activeAudioRef.current?.pause();
        activeAudioRef.current = audio;
      },
      releasePlayback: (audio) => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      },
    }),
    [],
  );

  return (
    <AudioPlayerGroupContext.Provider value={value}>
      {children}
    </AudioPlayerGroupContext.Provider>
  );
};

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src: initialSrc,
  onLoadRequest,
  totalSeconds,
  className = "",
  autoPlay = false,
}) => {
  const { t } = useTranslation();
  const group = useContext(AudioPlayerGroupContext);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(initialSrc ?? null);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const src = loadedSrc;
  const animationRef = useRef<number | undefined>(undefined);
  const loadRequestIdRef = useRef(0);
  const dragTimeRef = useRef<number>(0);

  // Use refs to avoid stale closures in animation loop
  const isPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  // Stable animation loop with no dependencies
  const tick = useCallback(() => {
    if (audioRef.current && !isDraggingRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
    }

    if (isPlayingRef.current) {
      animationRef.current = requestAnimationFrame(tick);
    }
  }, []); // Empty dependency array is key!

  // Manage animation loop lifecycle
  useEffect(() => {
    if (isPlaying && !isDragging) {
      // Only start if not already running
      if (!animationRef.current) {
        animationRef.current = requestAnimationFrame(tick);
      }
    } else {
      // Stop animation loop
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying, isDragging, tick]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    /* A stream whose length the decoder cannot state reports Infinity. Left
     * in place it becomes the scrubber's `max` and the track stops meaning
     * anything, so an unmeasurable file keeps the caller's declared length. */
    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setCurrentTime(0);
    };

    const handleEnded = () => {
      group?.releasePlayback(audio);
      setIsPlaying(false);
      setCurrentTime(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    const handlePlay = () => {
      group?.requestPlayback(audio);
      setIsPlaying(true);
    };
    const handlePause = () => {
      group?.releasePlayback(audio);
      setIsPlaying(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      group?.releasePlayback(audio);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [group]);

  // Auto-play when src becomes available (via onLoadRequest or autoPlay prop)
  const prevLoadedSrc = useRef<string | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Play when loadedSrc changes from null to a value (lazy load case)
    if (loadedSrc && !prevLoadedSrc.current && onLoadRequest) {
      audio.play().catch((error) => {
        console.error("Auto-play failed:", error);
      });
    }
    // Or when autoPlay is set with initial src
    else if (autoPlay && initialSrc && !prevLoadedSrc.current) {
      audio.play().catch((error) => {
        console.error("Auto-play failed:", error);
      });
    }

    prevLoadedSrc.current = loadedSrc;
  }, [loadedSrc, autoPlay, initialSrc, onLoadRequest]);

  // Global drag handlers
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (audioRef.current) {
        audioRef.current.currentTime = dragTimeRef.current;
        setCurrentTime(dragTimeRef.current);
      }
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("touchend", handleMouseUp);

      return () => {
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchend", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseUp]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (loadedSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(loadedSrc);
      }
    };
  }, [loadedSrc]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || isLoading) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    if (!src && onLoadRequest) {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      setIsLoading(true);

      try {
        const newSrc = await onLoadRequest();
        if (loadRequestIdRef.current === requestId && newSrc) {
          setLoadedSrc(newSrc);
        }
      } catch (error) {
        console.error("Playback failed:", error);
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }

      return;
    }

    if (src) {
      try {
        await audio.play();
      } catch (error) {
        console.error("Playback failed:", error);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    dragTimeRef.current = newTime;
    setCurrentTime(newTime);

    if (!isDragging && audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleSliderMouseDown = () => {
    setIsDragging(true);
  };

  const handleSliderTouchStart = () => {
    setIsDragging(true);
  };

  /* The length the scrubber spans. Before the media element has read its own
   * metadata that is whatever the caller measured; a caller with nothing to
   * declare gets a track it cannot drag, which is the truth. */
  const total = duration > 0 ? duration : (totalSeconds ?? 0);
  const seekable = duration > 0;
  /* ONE duration cell, right-aligned in the same 28px row. Idle it names the
   * total; while the head has moved it names the position, and at the end the
   * two coincide. The old second cell printed an elapsed "0s" beside a total
   * "0s" — one measurement twice, neither of them true. */
  const engaged = isPlaying || isDragging || currentTime > 0;
  const readoutValue = engaged
    ? readout(currentTime)
    : total > 0
      ? readout(total)
      : "—";

  return (
    <div className={`flex min-h-7 items-center gap-2 ${className}`}>
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        disabled={isLoading}
        className="flex size-7 flex-none cursor-pointer items-center justify-center rounded-control text-text-secondary transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-in-out)] outline-offset-[-2px] enabled:hover:bg-hover enabled:hover:text-text-primary enabled:active:bg-pressed disabled:cursor-not-allowed disabled:text-text-disabled"
        aria-label={
          isPlaying ? t("common.pause", "Pause") : t("common.play", "Play")
        }
        data-testid="audio-player-toggle"
      >
        {isPlaying ? (
          <Pause width={16} height={16} fill="currentColor" />
        ) : (
          <Play width={16} height={16} fill="currentColor" />
        )}
      </button>

      {/* A native range, deliberately: `appearance: none` without replacement
       * track and thumb rules is what reduced this control to a bare nub, and
       * the platform slider already carries keyboard stepping, Home/End and
       * the drag behaviour. `accent-color` paints the played span in the
       * app's one accent — a reported value, so it snaps with the input. */}
      <input
        type="range"
        aria-label={t("common.seek", "Playback position")}
        aria-valuetext={readout(currentTime)}
        min="0"
        max={total}
        step="0.01"
        value={currentTime}
        disabled={!seekable}
        onChange={handleSeek}
        onMouseDown={handleSliderMouseDown}
        onTouchStart={handleSliderTouchStart}
        className="h-5 min-w-0 flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        style={{ accentColor: "var(--color-accent)" }}
        data-testid="audio-player-seek"
      />

      {/* Wide enough for the longest string the shared renderer produces
       * ("10m 30s") so the track keeps its width as digits change instead of
       * shifting under the pointer. */}
      <span className="type-data w-14 flex-none text-end text-text-tertiary">
        {readoutValue}
      </span>
    </div>
  );
};
