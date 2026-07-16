import type { PerformanceScenario } from "./types";
import { googleStorePixelConfigScenario } from "./google-store-pixel-config";
import { trendyolManualTranslationScenario } from "./trendyol-manual-translation";

const scenarios: Record<string, PerformanceScenario> = {
  [googleStorePixelConfigScenario.id]: googleStorePixelConfigScenario,
  [trendyolManualTranslationScenario.id]: trendyolManualTranslationScenario,
};

export function loadPerformanceScenario(id: string): PerformanceScenario {
  const scenario = scenarios[id];
  if (!scenario) throw new Error(`Unknown performance scenario: ${id}. Available: ${Object.keys(scenarios).join(", ")}`);
  return scenario;
}

export { googleStorePixelConfigScenario, trendyolManualTranslationScenario };
export type { DiagnosticsBridge, PerformanceScenario, PerformanceScenarioContext, ScenarioStep } from "./types";
