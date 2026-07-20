import { getConversionRatesForPair } from "../services/conversionRateOrchestrator";
import { requestIranianBridgeRate } from "../services/iranianBridgeClient";
import { getExchangeRates } from "../services/rates";
import type {
  ExchangeRates,
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";
import type { UserSettings } from "../types/settings";
import { convertCurrency } from "../utils/currencyConverter";
import {
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
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
  getExchangeRates?: (
    targetCurrency: string
  ) => Promise<NormalizedRatesResponse>;
  requestIranianBridgeRate?: () => Promise<IranianBridgeRate>;
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
  rates: ExchangeRates | Map<string, ExchangeRates>,
  scanRoots?: readonly Node[],
  render: ConversionScanDependencies["renderConversions"] = renderConversions
): number {
  return render(textNodes, {
    ...getRenderOptionsBase(settings),
    renderCurrencies: true,
    renderUnits: false,
    scanRoots,
    convertAmount(match: CurrencyMatch) {
      const matchRates = rates instanceof Map ? rates.get(match.currency) : rates;

      if (!matchRates) {
        return null;
      }

      return convertCurrency(
        match.amount,
        match.currency,
        settings.targetCurrency,
        matchRates
      );
    },
  });
}

function discoverSourceCurrencies(
  textNodes: readonly Text[],
  groupedCurrencies: readonly { currency: string }[],
  targetCurrency: string
): Set<string> {
  const sourceCurrencies = new Set<string>();

  for (const node of textNodes) {
    for (const match of parseCurrencies(node.textContent ?? "")) {
      if (match.currency !== targetCurrency) {
        sourceCurrencies.add(match.currency);
      }
    }
  }

  for (const match of groupedCurrencies) {
    if (match.currency !== targetCurrency) {
      sourceCurrencies.add(match.currency);
    }
  }

  return sourceCurrencies;
}

export async function scanConversionRoots(
  request: ScanRequest,
  settings: UserSettings,
  dependencies: ConversionScanDependencies = {}
): Promise<ConversionScanResult> {
  const collect =
    dependencies.collectTextNodesForScan ?? collectTextNodesForScan;
  const loadRates = dependencies.getExchangeRates ?? getExchangeRates;
  const loadIranianBridge =
    dependencies.requestIranianBridgeRate ?? requestIranianBridgeRate;
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
  const groupedCurrencyCandidates =
    settings.converterMode === "units"
      ? []
      : detectGroupedPricesInRoots(roots);
  const hasGroupedCurrencyCandidates =
    textNodes.length === 0 && groupedCurrencyCandidates.length > 0;
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

  const sourceCurrencies = discoverSourceCurrencies(
    textNodes,
    groupedCurrencyCandidates,
    settings.targetCurrency
  );

  if (sourceCurrencies.size === 0) {
    return {
      scannedNodeCount: textNodes.length,
      renderedCount,
    };
  }

  const globalRatesByBase = new Map<
    string,
    Promise<NormalizedRatesResponse>
  >();
  let bridgePromise: Promise<IranianBridgeRate> | undefined;

  const getGlobalRates = (baseCurrency: string) => {
    let promise = globalRatesByBase.get(baseCurrency);

    if (!promise) {
      promise = Promise.resolve().then(() => loadRates(baseCurrency));
      globalRatesByBase.set(baseCurrency, promise);
    }

    return promise;
  };
  const getIranianBridge = () => {
    bridgePromise ??= Promise.resolve().then(() => loadIranianBridge());
    return bridgePromise;
  };
  const ratesBySource = new Map<string, ExchangeRates>();

  const composeRates = async () => {
    await Promise.all(
      [...sourceCurrencies].map(async (sourceCurrency) => {
        try {
          const rates = await getConversionRatesForPair({
            sourceCurrency,
            targetCurrency: settings.targetCurrency,
            getGlobalRates,
            getIranianBridge,
          });
          ratesBySource.set(sourceCurrency, rates);
        } catch (error) {
          writeDebug({
            type: "error",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );
  };

  if (perfDiagnosticsEnabled) {
    await measurePerfAsync("rates-load-total", composeRates);
  } else {
    await composeRates();
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

  if (ratesBySource.size === 0) {
    return {
      scannedNodeCount: textNodes.length,
      renderedCount,
    };
  }

  const renderCurrencies = () =>
    renderCurrencyConversionsOnly(
      textNodes,
      settings,
      ratesBySource,
      roots,
      render
    );
  renderedCount += perfDiagnosticsEnabled
    ? measurePerf(request.reason === "initial" ? "initial-render" : "badge-reconciliation", renderCurrencies)
    : renderCurrencies();

  return {
    scannedNodeCount: textNodes.length,
    renderedCount,
  };
}
