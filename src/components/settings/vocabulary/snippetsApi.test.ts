import { describe, expect, test } from "bun:test";
import { draftSnippet, triggerKey } from "./snippetsApi";

/* The command wrappers are one invoke call each and are exercised by the app;
 * what is worth pinning here are the two decisions that would fail silently:
 * the marker that asks for a new record, and the uniqueness key the editor
 * checks a trigger against before writing. */

describe("draftSnippet", () => {
  test("marks a new snippet with an empty id and starts it enabled", () => {
    const draft = draftSnippet("omw", "on my way");

    expect(draft.id).toBe("");
    expect(draft.enabled).toBe(true);
    expect(draft.trigger).toBe("omw");
    expect(draft.expansion).toBe("on my way");
  });
});

describe("triggerKey", () => {
  test("folds case and trims, matching trigger_key in Rust", () => {
    expect(triggerKey("  OMW ")).toBe(triggerKey("omw"));
    expect(triggerKey("Best Regards")).toBe("best regards");
  });

  test("keeps different triggers apart", () => {
    expect(triggerKey("omw") === triggerKey("omg")).toBe(false);
  });
});
