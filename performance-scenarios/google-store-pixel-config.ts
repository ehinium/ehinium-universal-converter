import type { Locator } from "playwright";
import type { PerformanceScenario } from "./types";

async function clickFirstVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  for (let index = 0; index < count; index++) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ force: true, timeout: 5_000 });
      return true;
    }
  }
  return false;
}

export const googleStorePixelConfigScenario: PerformanceScenario = {
  id: "google-store-pixel-config",
  description: "Selects Pixel configuration options, verifies a conversion badge, changes an option, then exercises sticky and narrow layouts.",
  supportedUrlPatterns: [/^https:\/\/store\.google\.com\/.*\/config\/pixel_/i],
  workloadContract: { minimumParserMatches: 1, minimumActiveBadges: 1, minimumRenderedBadges: 1,
    minimumMutationBatches: 1, requireSuccessfulStabilization: true, requireNoPendingWork: true },
  async run(context) {
    const { page } = context;
    await context.recordStep("wait-for-product-configurator", async () => {
      await page.getByRole("main").waitFor({ state: "visible", timeout: 20_000 });
      await page.getByRole("heading", { name: /pixel/i }).first().waitFor({ state: "visible", timeout: 20_000 });
    });
    await context.recordStep("capture-before-interaction", () => context.captureScreenshot("google-store-before-interaction"));
    await context.recordStep("dismiss-consent-or-region-prompt", async () => {
      const button = page.getByRole("button", { name: /^(accept all|accept|agree|no thanks|continue)$/i }).first();
      if (await button.isVisible({ timeout: 1500 }).catch(() => false)) await button.click();
    }, undefined, true);
    await context.recordStep("select-required-options", async () => {
      const candidates = page.getByRole("radio");
      const count = await candidates.count();
      let selected = 0;
      if (count > 0) {
        for (let index = 0; index < count; index++) {
          const option = candidates.nth(index);
          if (await option.isVisible().catch(() => false) && !(await option.isChecked().catch(() => false))) {
            await option.click(); selected++; await page.waitForTimeout(300);
          }
        }
      } else {
        const semanticOptions = [
          page.getByText(/^Pixel 10 Pro(?:\s|$)/),
          page.getByText(/^Obsidian(?:\s|$)/),
          page.getByText(/^(128 GB|256 GB|512 GB|1 TB)(?:\s|$)/),
        ];
        for (const option of semanticOptions) {
          if (await clickFirstVisible(option)) {
            selected++; await page.waitForTimeout(400);
          }
        }
      }
      if (selected === 0) throw new Error("No semantic product configuration controls were resolved");
    });
    await context.recordStep("wait-for-recognized-price", async () => {
      await page.getByText(/[£$€]\s?\d[\d,.]*/).first().waitFor({ state: "visible", timeout: 15_000 });
      if (context.mode === "extension-enabled" || context.mode === "diagnostics-enabled") {
        await context.waitForWorkload({ parserMatches: 1, activeBadges: 1 }, 20_000);
        await context.captureWorkloadSnapshot("first-valid-workload");
      }
    });
    await context.recordStep("change-configuration-option", async () => {
      const radios = page.getByRole("radio");
      let changed = false;
      for (let index = 0; index < await radios.count(); index++) {
        const option = radios.nth(index);
        if (await option.isVisible().catch(() => false) && !(await option.isChecked().catch(() => false))) {
          await option.click(); changed = true; break;
        }
      }
      if (!changed) {
        changed = await clickFirstVisible(page.getByText(/^(256 GB|512 GB|1 TB)(?:\s|$)/));
      }
      if (!changed) throw new Error("No alternate semantic configuration option was available");
      if (context.mode === "extension-enabled" || context.mode === "diagnostics-enabled") {
        await context.waitForExtensionIdle();
        await context.waitForWorkload({ activeBadges: 1 }, 15_000);
      }
    });
    await context.recordStep("exercise-sticky-price-states", async () => {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (const y of [0, Math.round(height * 0.35), Math.round(height * 0.75), 0]) {
        await page.evaluate((nextY) => scrollTo(0, nextY), y);
        await page.waitForTimeout(250);
      }
    });
    await context.recordStep("exercise-narrow-desktop", async () => {
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.waitForTimeout(400);
      await page.setViewportSize({ width: 1440, height: 900 });
      await context.waitForExtensionIdle();
      if (context.mode === "extension-enabled" || context.mode === "diagnostics-enabled") {
        await context.captureWorkloadSnapshot("final-workload");
      }
      await context.captureScreenshot("google-store-final");
    });
  },
};

export default googleStorePixelConfigScenario;
