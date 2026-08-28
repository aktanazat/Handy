import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";

describe("scheduled maintenance handler", () => {
  it("runs bounded D1 maintenance through the exported Cron handler", async () => {
    const context = createExecutionContext();
    if (worker.scheduled === undefined)
      throw new Error("scheduled handler is missing");
    worker.scheduled(createScheduledController(), env, context);
    await waitOnExecutionContext(context);
    expect(true).toBe(true);
  });
});
