const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ONE_DECIMAL_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatModelSize = (sizeMb: number | null | undefined): string => {
  if (!sizeMb || !Number.isFinite(sizeMb) || sizeMb <= 0) {
    return "Unknown size";
  }

  if (sizeMb >= 1024) {
    const sizeGb = sizeMb / 1024;
    const formatter =
      sizeGb >= 10 ? WHOLE_NUMBER_FORMATTER : ONE_DECIMAL_FORMATTER;
    return `${formatter.format(sizeGb)} GB`;
  }

  const formatter =
    sizeMb >= 100 ? WHOLE_NUMBER_FORMATTER : ONE_DECIMAL_FORMATTER;

  return `${formatter.format(sizeMb)} MB`;
};

const sameYear = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear();

/** "Aug 28, 6:52 PM" (locale-aware; adds the year when it differs). */
export const formatEntryTimestamp = (
  timestampMs: number,
  now: Date = new Date(),
): string => {
  const date = new Date(timestampMs);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear(date, now) ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

/** "0s" | "15s" | "3m 12s" | "1h 4m" - explicit units, no zero padding. */
export const formatDurationShort = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
};

const RELATIVE_STEPS: Array<
  [limitSeconds: number, unit: Intl.RelativeTimeFormatUnit, unitSeconds: number]
> = [
  [3600, "minute", 60],
  [86400, "hour", 3600],
  [86400 * 14, "day", 86400],
];

/** "this minute" | "2 minutes ago" | "1 hour ago"; absolute date past 14 days. */
export const formatRelativeTime = (
  timestampMs: number,
  nowMs: number = Date.now(),
): string => {
  const elapsedSeconds = Math.max(0, (nowMs - timestampMs) / 1000);
  for (const [limit, unit, unitSeconds] of RELATIVE_STEPS) {
    if (elapsedSeconds < limit) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        -Math.floor(elapsedSeconds / unitSeconds),
        unit,
      );
    }
  }
  return formatEntryTimestamp(timestampMs, new Date(nowMs));
};
