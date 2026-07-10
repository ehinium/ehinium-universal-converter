import { getExchangeRates } from "../services/rates";
import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { convertCurrency } from "../utils/currencyConverter";
import type { CurrencyMatch } from "../utils/currencyParser";
import { debugLog, type DebugEvent } from "./debug";
import { renderConversions, type RenderConversionOptions } from "./domRenderer";
import type { ScanRequest } from "./scanScheduler";
import { collectTextNodesForScan } from "./scanRoots";

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
  render: ConversionScanDependencies["renderConversions"] = renderConversions
): number {
  return render(textNodes, {
    ...getRenderOptionsBase(settings),
    renderCurrencies: true,
    renderUnits: false,
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
  const textNodes = await collect(roots);
  let renderedCount = 0;

  if (textNodes.length === 0) {
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
    renderedCount += renderUnitConversionsOnly(textNodes, settings, render);
    return {
      scannedNodeCount: textNodes.length,
      renderedCount,
    };
  }

  if (settings.converterMode === "everything") {
    renderedCount += renderUnitConversionsOnly(textNodes, settings, render);
  }

  let ratesData: { rates: ExchangeRates };

  try {
    ratesData = await loadRates(settings.targetCurrency);
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

  renderedCount += renderCurrencyConversionsOnly(
    textNodes,
    settings,
    ratesData.rates,
    render
  );

  return {
    scannedNodeCount: textNodes.length,
    renderedCount,
  };
}
