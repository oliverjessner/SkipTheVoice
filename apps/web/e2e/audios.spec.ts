import { test, expect } from "@playwright/test";

test("a fresh account contains no fabricated data and marks the active navigation item", async ({ page }) => {
  await page.goto("/audios");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" }).first();
  await expect(navigation).toContainText("Audios");
  await expect(navigation).toContainText("Settings");
  await expect(navigation.getByRole("link", { name: "Audios" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  await expect(page.getByText("No voice messages found")).toBeVisible();

  await navigation.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Audios" })).not.toHaveAttribute("aria-current");
  await expect(page.getByText("No WhatsApp connection configured")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transcription engine" })).toHaveCount(0);
});
