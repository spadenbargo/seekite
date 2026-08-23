import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import lighthouse from "lighthouse";
import { chromium, expect, test } from "@playwright/test";

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a Chrome debugging port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForDebugger(port: number, attempts = 80): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (response.ok) return;
  } catch {
    // Chrome is still starting.
  }
  if (attempts <= 1) throw new Error("Chrome debugging endpoint did not start");
  await new Promise((resolve) => setTimeout(resolve, 100));
  return waitForDebugger(port, attempts - 1);
}

async function stopChrome(chrome: ChildProcess): Promise<void> {
  if (chrome.exitCode !== null || chrome.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
  chrome.kill();
  await exited;
}

test("a documentation page meets the Lighthouse performance budget", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "Lighthouse drives the bundled Chromium executable");
  const userDataDir = await mkdtemp(path.join(tmpdir(), "seekite-lighthouse-"));
  const port = await availablePort();
  const chrome = spawn(
    chromium.executablePath(),
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForDebugger(port);
    const result = await lighthouse("http://127.0.0.1:4173/docs/search-quality", {
      port,
      logLevel: "error",
      onlyCategories: ["performance"],
      output: "json",
    });
    const score = result?.lhr.categories.performance?.score ?? 0;
    // The Fumadocs responsive navigation, sidebar and TOC raise the tested
    // shell's transfer cost while preserving zero blocking time and layout
    // shift. Keep a stable floor alongside the build's 210 KiB gzip cap.
    expect(
      score,
      `Lighthouse performance score was ${Math.round(score * 100)}`,
    ).toBeGreaterThanOrEqual(0.9);
  } finally {
    await stopChrome(chrome);
    await rm(userDataDir, { recursive: true, force: true });
  }
});
