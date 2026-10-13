import { expect, test } from "@playwright/test";

const projectId = process.env.PLAYWRIGHT_PROJECT_ID;
const hasStorageState = Boolean(process.env.PLAYWRIGHT_STORAGE_STATE);

test("signed-in project settlement is displayed and reconciles", async ({ page }) => {
  test.skip(!projectId || !hasStorageState, "Set PLAYWRIGHT_PROJECT_ID and PLAYWRIGHT_STORAGE_STATE to test a signed-in project");

  await page.goto(`/p/${projectId}/settlement`);

  await expect(page.getByRole("heading", { name: "Settlement" })).toBeVisible();
  await expect(page.getByText("Checked: all amounts add up exactly.")).toBeVisible();
});