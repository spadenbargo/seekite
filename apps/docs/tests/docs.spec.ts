import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the worker-backed dialog ranks the typo-tolerant result first", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search docs" }).waitFor();
  await page.keyboard.press("Control+K");

  const dialog = page.getByRole("dialog", { name: "Search Seekite documentation" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("typo tolarance");

  const firstResult = dialog.getByRole("option").first();
  await expect(firstResult).toContainText("Search quality", { timeout: 30_000 });
  const dialogAccessibility = await new AxeBuilder({ page }).include(".seekite-overlay").analyze();
  expect(dialogAccessibility.violations).toEqual([]);
  await firstResult.click();
  await expect(page).toHaveURL(/\/docs\/search-quality$/);
});

test("the color mode toggles and persists", async ({ page }) => {
  await page.goto("/");
  const toggle = page.locator(".theme-toggle");
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  expect(initialTheme === "light" || initialTheme === "dark").toBeTruthy();

  await toggle.click();
  const nextTheme = initialTheme === "dark" ? "light" : "dark";
  await expect(page.locator("html")).toHaveAttribute("data-theme", nextTheme);
  expect(await page.evaluate(() => localStorage.getItem("seekite-theme"))).toBe(nextTheme);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", nextTheme);
});

test("documentation code blocks contain highlighted tokens", async ({ page }) => {
  await page.goto("/docs/getting-started");
  await expect(page.locator("pre .th-keyword").first()).toBeVisible();
  await expect(page.locator("pre .th-string").first()).toBeVisible();
});

for (const path of ["/", "/docs/search-quality"] as const) {
  test(`${path} has no automatically detectable accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main#main-content")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
