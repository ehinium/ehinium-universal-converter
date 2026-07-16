import type { PerformanceScenario } from "./types";

export const trendyolManualTranslationScenario: PerformanceScenario = {
  id: "trendyol-manual-translation",
  description: "Records badge-registry state across manual Chrome translation enable, language switch, and disable phases.",
  supportedUrlPatterns: [/^https:\/\/(?:www\.)?trendyol\./i],
  workloadContract: { minimumParserMatches: 1, minimumActiveBadges: 1, requireSuccessfulStabilization: true,
    requireNoPendingWork: true, requireRegistryDomParity: true, maximumOrphanBadgeHosts: 0, maximumCompetingBadgeHosts: 0 },
  async run(context) {
    if (context.headless) throw new Error("trendyol-manual-translation requires --headful");
    await context.recordStep("record-untranslated-baseline", async () => {
      await context.waitForWorkload({ parserMatches: 1, activeBadges: 1 }, 20_000);
      await context.captureWorkloadSnapshot("translation-baseline");
    });
    const phases = [
      ["enable-translation", "Enable Chrome translation, wait for the page to finish translating, then press Enter."],
      ["switch-translation-language", "Switch the Chrome translation language once, wait for completion, then press Enter."],
      ["disable-translation", "Disable Chrome translation, wait for the original page language, then press Enter."],
    ] as const;
    for (const [name, instruction] of phases) {
      await context.recordStep(name, async () => {
        const confirmedAt = await context.manualCheckpoint(instruction);
        await context.diagnostics.markScenario(`${name}:${confirmedAt}`);
        await context.waitForExtensionIdle({ quietWindowMs: 1000, timeoutMs: 20_000 });
        return { confirmedAt, snapshot: await context.captureWorkloadSnapshot(name) };
      });
    }
  },
};

export default trendyolManualTranslationScenario;
