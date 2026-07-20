import { fiatCurrencies } from "../data/currencies";
import type {
  ExchangeRates,
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";
import { composeConversionRates } from "./conversionRates";

export type GetConversionRatesForPairOptions = {
  sourceCurrency: string;
  targetCurrency: string;
  getGlobalRates: (
    baseCurrency: string
  ) => Promise<NormalizedRatesResponse>;
  getIranianBridge: () => Promise<IranianBridgeRate>;
};

const canonicalCurrencyCodes = new Set(
  fiatCurrencies.map((currency) => currency.code)
);
const iranianCurrencyCodes = new Set(["IRT", "IRR"]);

function normalizeCurrency(value: string, label: "Source" | "Target"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} currency is required`);
  }

  const normalized = value.trim().toUpperCase();
  if (!canonicalCurrencyCodes.has(normalized)) {
    throw new Error(`Unknown canonical currency: "${normalized}"`);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateBridgeRate(bridge: IranianBridgeRate): number {
  if (
    !isRecord(bridge) ||
    bridge.provider !== "ehinium" ||
    bridge.unit !== "IRT" ||
    !isPositiveFiniteNumber(bridge.usdSellIrt)
  ) {
    throw new Error("Iranian bridge rate is invalid");
  }

  return bridge.usdSellIrt;
}

function requireDerivedRate(value: number): number {
  if (!isPositiveFiniteNumber(value)) {
    throw new Error("Derived conversion rate is invalid");
  }

  return value;
}

function validatePairRates(
  rates: ExchangeRates,
  sourceCurrency: string,
  targetCurrency: string
): ExchangeRates {
  if (rates[targetCurrency] !== 1) {
    throw new Error("Conversion rates target is invalid");
  }

  if (!isPositiveFiniteNumber(rates[sourceCurrency])) {
    throw new Error("Required source conversion rate is unavailable");
  }

  return rates;
}

function composeLocalIranianRates(targetCurrency: "IRT" | "IRR"): ExchangeRates {
  return targetCurrency === "IRT"
    ? { IRT: 1, IRR: 10 }
    : { IRR: 1, IRT: 0.1 };
}

function composeUsdTargetRates(bridge: IranianBridgeRate): ExchangeRates {
  const usdSellIrt = validateBridgeRate(bridge);

  return {
    USD: 1,
    IRT: requireDerivedRate(usdSellIrt),
    IRR: requireDerivedRate(usdSellIrt * 10),
  };
}

export async function getConversionRatesForPair(
  options: GetConversionRatesForPairOptions
): Promise<ExchangeRates> {
  const sourceCurrency = normalizeCurrency(options.sourceCurrency, "Source");
  const targetCurrency = normalizeCurrency(options.targetCurrency, "Target");

  if (sourceCurrency === targetCurrency) {
    return { [targetCurrency]: 1 };
  }

  const sourceIsIranian = iranianCurrencyCodes.has(sourceCurrency);
  const targetIsIranian = iranianCurrencyCodes.has(targetCurrency);

  if (sourceIsIranian && targetIsIranian) {
    return validatePairRates(
      composeLocalIranianRates(targetCurrency as "IRT" | "IRR"),
      sourceCurrency,
      targetCurrency
    );
  }

  if (!sourceIsIranian && !targetIsIranian) {
    const globalRates = await options.getGlobalRates(targetCurrency);
    return validatePairRates(
      composeConversionRates({ targetCurrency, globalRates }),
      sourceCurrency,
      targetCurrency
    );
  }

  if (sourceCurrency === "USD" && targetIsIranian) {
    const bridge = await options.getIranianBridge();
    return validatePairRates(
      composeConversionRates({
        targetCurrency,
        iranianBridge: bridge,
      }),
      sourceCurrency,
      targetCurrency
    );
  }

  if (sourceIsIranian && targetCurrency === "USD") {
    const bridge = await options.getIranianBridge();
    return validatePairRates(
      composeUsdTargetRates(bridge),
      sourceCurrency,
      targetCurrency
    );
  }

  if (targetIsIranian) {
    const [globalRates, bridge] = await Promise.all([
      options.getGlobalRates("USD"),
      options.getIranianBridge(),
    ]);
    return validatePairRates(
      composeConversionRates({
        targetCurrency,
        globalRates,
        iranianBridge: bridge,
      }),
      sourceCurrency,
      targetCurrency
    );
  }

  const [globalRates, bridge] = await Promise.all([
    options.getGlobalRates(targetCurrency),
    options.getIranianBridge(),
  ]);
  return validatePairRates(
    composeConversionRates({
      targetCurrency,
      globalRates,
      iranianBridge: bridge,
    }),
    sourceCurrency,
    targetCurrency
  );
}
