import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauri-mock";

/* Two focus indicators, each owning a kind of control: something you press
 * shows a 2px bronze indicator around it, something you type in shows its own
 * edge and nothing around it. The second rule exists because a text field
 * matches :focus-visible on a plain click, so the offset outline read as a
 * second box drawn around the box being typed in — on the chat composer,
 * whose wrapper already darkens its hairline, two boxes at once. */
const BRONZE = "rgb(139, 90, 43)";

test.describe("the focus indicator", () => {
  test("a pressed control shows a bronze indicator", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();

    await page.keyboard.press("Tab");
    const shown = await page.evaluate((bronze) => {
      const node = document.activeElement;
      if (node === null) return { focused: false };
      const style = getComputedStyle(node);
      return {
        focused: node.matches(":focus-visible"),
        tag: node.tagName,
        /* Either treatment counts, and both are the same colour: the app-wide
         * outline from base.css, or a component's own ring, which the kit
         * draws as a box-shadow. */
        marked:
          (style.outlineStyle !== "none" && style.outlineColor === bronze) ||
          style.boxShadow.includes(bronze),
      };
    }, BRONZE);

    expect(shown.focused).toBe(true);
    expect(shown.marked).toBe(true);
  });

  test("a typed field shows its own edge and nothing around it", async ({
    page,
  }) => {
    await installTauriMock(page);
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await page.keyboard.press("Meta+k");
    const field = page.getByRole("combobox");
    await expect(field).toBeVisible();
    await field.click();

    const edge = await field.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        focusVisible: node.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });

    expect(edge.focusVisible).toBe(true);
    expect(edge.outlineStyle).toBe("none");
    expect(edge.outlineWidth).toBe("0px");
  });
});
