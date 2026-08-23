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

  await page.goto("/");
  await page.getByRole("button", { name: "Search docs" }).click();
  const reopened = page.getByRole("dialog", { name: "Search Seekite documentation" });
  const reopenedInput = reopened.getByRole("combobox");
  await reopenedInput.fill("typo tolarance");
  await expect(reopened.getByRole("option").first()).toContainText("Search quality", {
    timeout: 30_000,
  });
  await reopenedInput.press("Enter");
  await expect(reopened).toBeHidden();
  await expect(page).toHaveURL(/\/docs\/search-quality$/);
});

test("the search dialog closes from every trusted interaction without losing its query", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Search Seekite documentation" });
  const open = async (): Promise<void> => {
    await page.keyboard.press("Control+K");
    await expect(dialog).toBeVisible();
  };

  await open();
  let input = dialog.getByRole("combobox");
  await input.press("Escape");
  await expect(dialog).toBeHidden();

  await open();
  input = dialog.getByRole("combobox");
  await input.fill("search quality");
  await expect(dialog.getByRole("option").first()).toBeVisible({ timeout: 30_000 });

  await input.press("Escape");
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(0);
  await expect(dialog).toBeHidden();

  await open();
  await expect(dialog.getByRole("combobox")).toHaveValue("search quality");
  await page.keyboard.press("Control+K");
  await expect(dialog).toBeHidden();

  await open();
  await dialog.getByRole("button", { name: "Close search" }).click();
  await expect(dialog).toBeHidden();

  await open();
  const close = dialog.getByRole("button", { name: "Close search" });
  await close.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await open();
  const facet = dialog.locator(".seekite-facet").first();
  await expect(facet).toBeVisible({ timeout: 30_000 });
  await facet.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await open();
  const result = dialog.getByRole("option").first();
  await result.evaluate((element) => element.setAttribute("tabindex", "0"));
  await result.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await open();
  const overlay = page.locator(".seekite-overlay");
  await overlay.click({ button: "right", position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();
  await overlay.click({ button: "left", position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
});

test("the live index stays inline and closes without reopening the site dialog", async ({
  page,
}) => {
  await page.goto("/");
  const demo = page.locator(".search-demo");
  const input = demo.getByRole("combobox", { name: "Live documentation search" });

  await input.click();
  await expect(demo.locator(".seekite-panel")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Search Seekite documentation" })).toBeHidden();

  await demo.getByRole("button", { name: "Close search" }).click();
  await expect(demo.locator(".seekite-panel")).toBeHidden();

  await input.click();
  await input.fill("search quality");
  await expect(demo.getByRole("option").first()).toBeVisible({ timeout: 30_000 });
  await input.press("Escape");
  await expect(demo.locator(".seekite-panel")).toBeHidden();

  await input.click();
  await page.getByRole("heading", { name: "Search your site." }).click();
  await expect(demo.locator(".seekite-panel")).toBeHidden();
});

for (const theme of ["light", "dark"] as const) {
  test(`the seeded search dialog matches the ${theme} visual contract`, async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "Visual baselines are recorded in Chromium");
    await page.addInitScript((value) => localStorage.setItem("seekite-theme", value), theme);
    await page.goto("/");
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Search Seekite documentation" });
    await dialog.getByRole("combobox").fill("typo tolarance");
    await expect(dialog.getByRole("option").first()).toContainText("Search quality", {
      timeout: 30_000,
    });
    await expect(page.locator("html")).toHaveClass(new RegExp(`(?:^|\\s)${theme}(?:\\s|$)`));
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(dialog).toHaveScreenshot(`search-dialog-${theme}.png`, {
      animations: "disabled",
      caret: "hide",
    });
  });
}

test("the color mode toggles and persists", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Toggle Theme" });
  const initialClass = (await page.locator("html").getAttribute("class")) ?? "";
  const initialTheme = initialClass.split(/\s+/).includes("dark") ? "dark" : "light";

  await toggle.click();
  const nextTheme = initialTheme === "dark" ? "light" : "dark";
  await expect(page.locator("html")).toHaveClass(new RegExp(`(?:^|\\s)${nextTheme}(?:\\s|$)`));
  expect(await page.evaluate(() => localStorage.getItem("seekite-theme"))).toBe(nextTheme);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(new RegExp(`(?:^|\\s)${nextTheme}(?:\\s|$)`));
});

test("the homepage serves theme-aware integration icons locally", async ({ page }) => {
  const requestedOrigins = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") requestedOrigins.add(url.origin);
  });
  await page.addInitScript(() => localStorage.setItem("seekite-theme", "light"));
  await page.goto("/");

  const icons = page.locator("[data-brand-icon]");
  await expect(icons).toHaveCount(4);
  /* eslint-disable no-await-in-loop -- lazy images must be scrolled and decoded sequentially */
  for (const name of ["Vite", "Astro", "Next.js", "Docusaurus"] as const) {
    const container = page.locator(`[data-brand-icon="${name}"]`);
    await container.scrollIntoViewIfNeeded();
    const rendered = container.locator("img:visible");
    await expect(rendered).toHaveCount(1);
    await expect
      .poll(() =>
        rendered.evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
      )
      .toBeGreaterThan(0);
  }
  /* eslint-enable no-await-in-loop */

  const astro = page.locator('[data-brand-icon="Astro"]');
  const lightIcon = astro.locator('[data-icon-theme="light"]');
  const darkIcon = astro.locator('[data-icon-theme="dark"]');
  await expect(lightIcon).toBeVisible();
  await expect(darkIcon).toBeHidden();

  await page.getByRole("button", { name: "Toggle Theme" }).click();
  await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);
  await expect(lightIcon).toBeHidden();
  await expect(darkIcon).toBeVisible();
  await expect
    .poll(() =>
      darkIcon.evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
    )
    .toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");

  const firstPartyOrigin = new URL(page.url()).origin;
  expect([...requestedOrigins].filter((origin) => origin !== firstPartyOrigin)).toEqual([]);
});

test("documentation code blocks contain highlighted tokens", async ({ page }) => {
  await page.goto("/docs/getting-started");
  await expect(page.locator("pre .th-keyword").first()).toBeVisible();
  await expect(page.locator("pre .th-string").first()).toBeVisible();
});

for (const path of ["/", "/docs/search-quality"] as const) {
  test(`${path} has no automatically detectable accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("#main-content")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
