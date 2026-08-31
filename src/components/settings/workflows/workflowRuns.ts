import type { WorkflowRunReceipt } from "@/bindings";

const localDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

/** Counts the loaded receipts into the seven local calendar days ending today. */
export const runsForLastSevenDays = (
  receipts: readonly WorkflowRunReceipt[],
  nowMs: number = Date.now(),
): number[] => {
  const dayKeys: string[] = [];
  const cursor = new Date(nowMs);
  cursor.setHours(0, 0, 0, 0);

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() - offset);
    dayKeys.push(localDateKey(day));
  }

  const values = Array<number>(dayKeys.length).fill(0);
  for (const receipt of receipts) {
    const index = dayKeys.indexOf(
      localDateKey(new Date(receipt.started_at_utc_ms)),
    );
    if (index >= 0) values[index] += 1;
  }
  return values;
};
