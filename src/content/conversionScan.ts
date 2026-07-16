import { getExchangeRates } from "../services/rates";
import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { convertCurrency } from "../utils/currencyConverter";
import type { CurrencyMatch } from "../utils/currencyParser";
import { debugLog, type DebugEvent } from "./debug";
import { renderConversions, type RenderConversionOptions } from "./domRenderer";
import type { ScanRequest } from "./scanScheduler";
import { collectTextNodesForScan } from "./scanRoots";
import { detectGroupedPricesInRoots } from "./groupedPriceDetector";
import { incrementPerfCounter, measurePerf, measurePerfAsync } from "./perfDiagnostics";

export type ConversionScanResult = {
  scannedNodeCount: number;
  renderedCount: number;
};

export type ConversionScanDependencies = {
  collectTextNodesForScan?: (roots: readonly Node[]) => Promise<Text[]>;
  getExchangeRates?: (targetCurrency: string) => Promise<{ rates: ExchangeRates }>;
  renderConversions?: (
    textNodes: Iterable<Text>,
    options: RenderConversionOptions
  ) => number;
  settingsChanged?: () => boolean;
  debugLog?: (event: DebugEvent) => void;
};

function getRenderOptionsBase(settings: UserSettings): Omit<
  RenderConversionOptions,
  "convertAmount" | "renderCurrencies" | "renderUnits"
> {
  return {
    enabled: settings.enabled,
    targetCurrency: settings.targetCurrency,
    converterMode: settings.converterMode,
    badgeStyle: settings.badgeStyle,
    badgeVisibility: settings.badgeVisibility,
    unitSystem: settings.unitSystem,
    targetLengthUnit: settings.targetLengthUnit,
    targetWeightUnit: settings.targetWeightUnit,
    targetTemperatureUnit: settings.targetTemperatureUnit,
  };
}

export function renderUnitConversionsOnly(
  textNodes: readonly Text[],
  settings: UserSettings,
  render: ConversionScanDependencies["renderConversions"] = renderConversions
): number {
  return render(textNodes, {
    ...getRenderOptionsBase(settings),
    renderCurrencies: false,
    renderUnits: true,
    convertAmount: () => null,
  });
}

export function renderCurrencyConversionsOnly(
  textNodes: readonly Text[],
  settings: UserSettings,
  rates: ExchangeRates,
  scanRoots?: readonly Node[],
  render: ConversionScanDependencies["renderConversions"] = renderConversions
): number {
  return render(textNodes, {
    ...getRenderOptionsBase(settings),
    renderCurrencies: true,
    renderUnits: false,
    scanRoots,
    convertAmount(match: CurrencyMatch) {
      return convertCurrency(
        match.amount,
        match.currency,
        settings.targetCurrency,
        rates
      );
    },
  });
}

export async function scanConversionRoots(
  request: ScanRequest,
  settings: UserSettings,
  dependencies: ConversionScanDependencies = {}
): Promise<ConversionScanResult> {
  const collect =
    dependencies.collectTextNodesForScan ?? collectTextNodesForScan;
  const loadRates = dependencies.getExchangeRates ?? getExchangeRates;
  const render = dependencies.renderConversions ?? renderConversions;
  const writeDebug = dependencies.debugLog ?? debugLog;
  const roots = request.roots ?? [document.body];
  const perfDiagnosticsEnabled = typeof __EUC_PERF_DIAGNOSTICS__ !== "undefined" && __EUC_PERF_DIAGNOSTICS__;
  const textNodes = perfDiagnosticsEnabled
    ? await measurePerfAsync("candidate-discovery", () => collect(roots))
    : await collect(roots);
  if (perfDiagnosticsEnabled) {
    incrementPerfCounter("totalDomNodesVisited", textNodes.length);
    incrementPerfCounter("priceLikeElementsInspected", textNodes.length);
  }
  const hasGroupedCurrencyCandidates =
    textNodes.length === 0 &&
    settings.converterMode !== "units" &&
    detectGroupedPricesInRoots(roots).length > 0;
  let renderedCount = 0;

  if (textNodes.length === 0 && !hasGroupedCurrencyCandidates) {
    writeDebug({
      type: "scan:skipped",
      reason: "No eligible text nodes",
      scannedNodeCount: 0,
    });
    return {
      scannedNodeCount: 0,
      renderedCount: 0,
    };
  }

  if (settings.converterMode === "units") {
    renderedCount += perfDiagnosticsEnabled
      ? measurePerf(request.reason === "initial" ? "initial-render" : "badge-reconciliation", () => renderUnitConversionsOnly(textNodes, settings, render))
      : renderUnitConversionsOnly(textNodes, settings, render);
    return {
      scannedNodeCount: textNodes.length,
      renderedCount,
    };
  }

  if (settings.converterMode === "everything") {
    renderedCount += perfDiagnosticsEnabled
      ? measurePerf(request.reason === "initial" ? "initial-render" : "badge-reconciliation", () => renderUnitConversionsOnly(textNodes, settings, render))
      : renderUnitConversionsOnly(textNodes, settings, render);
  }

  let ratesData: { rates: ExchangeRates };

  try {
    ratesData = perfDiagnosticsEnabled
      ? await measurePerfAsync("rates-cache-lookup", () => loadRates(settings.targetCurrency))
      : await loadRates(settings.targetCurrency);
  } catch (error) {
    writeDebug({
      type: "error",
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      scannedNodeCount: textNodes.length,
      renderedCount,
    };
  }

  if (dependencies.settingsChanged?.()) {
    writeDebug({
      type: "scan:skipped",
      reason: "Settings changed before render",
      scannedNodeCount: textNodes.length,
    });
    return {
      scannedNodeCount: textNodes.length,
      renderedCount,
    };
  }

  const renderCurrencies = () => renderCurrencyConversionsOnly(textNodes, settings, ratesData.rates, roots, render);
  renderedCount += perfDiagnosticsEnabled
    ? measurePerf(request.reason === "initial" ? "initial-render" : "badge-reconciliation", renderCurrencies)
    : renderCurrencies();

  return {
    scannedNodeCount: textNodes.length,
    renderedCount,
  };
}
