import { globalProviderFiatCurrencies } from "../data/currencies";
import type {
  ExchangeRates,
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";

export type ComposeConversionRatesOptions = {
  targetCurrency: string;
  globalRates?: NormalizedRatesResponse;
  iranianBridge?: IranianBridgeRate;
};

const globalProviderCurrencyCodes = new Set(
  globalProviderFiatCurrencies.map((currency) => currency.code)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function requireValidBridge(bridge: IranianBridgeRate | undefined): number {
  if (!bridge) {
    throw new Error("Iranian bridge rate is required");
  }

  if (
    !isRecord(bridge) ||
    bridge.unit !== "IRT" ||
    bridge.provider !== "ehinium" ||
    !isPositiveFiniteNumber(bridge.usdSellIrt)
  ) {
    throw new Error("Iranian bridge rate is invalid");
  }

  return bridge.usdSellIrt;
}

function requireGlobalRates(
  response: NormalizedRatesResponse | undefined
): NormalizedRatesResponse {
  if (!response) {
    throw new Error("Global rates are required for the requested target currency");
  }

  return response;
}

function copyValidatedGlobalRates(
  response: NormalizedRatesResponse
): ExchangeRates {
  if (
    !isRecord(response) ||
    typeof response.base !== "string" ||
    !isRecord(response.rates)
  ) {
    throw new Error("Global rates response is invalid");
  }

  const base = response.base.trim().toUpperCase();
  const rates: ExchangeRates = {};

  for (const [code, value] of Object.entries(response.rates)) {
    const normalizedCode = code.toUpperCase();

    if (!globalProviderCurrencyCodes.has(normalizedCode)) continue;
    if (!isPositiveFiniteNumber(value)) {
      throw new Error("Global rates response is invalid");
    }

    rates[normalizedCode] = value;
  }

  if (rates[base] !== 1) {
    throw new Error("Global rates response is invalid");
  }

  return rates;
}

function requireDerivedRate(value: number): number {
  if (!isPositiveFiniteNumber(value)) {
    throw new Error("Derived conversion rate is invalid");
  }

  return value;
}

function composeGlobalTargetRates(
  targetCurrency: string,
  globalRates: NormalizedRatesResponse,
  bridge: IranianBridgeRate | undefined
): ExchangeRates {
  if (!isRecord(globalRates) || typeof globalRates.base !== "string") {
    throw new Error("Global rates response is invalid");
  }

  if (globalRates.base.trim().toUpperCase() !== targetCurrency) {
    throw new Error("Global rates base does not match the requested target currency");
  }

  const rates = copyValidatedGlobalRates(globalRates);
  if (!bridge) return rates;

  const usdSellIrt = requireValidBridge(bridge);
  const usdPerTarget = rates.USD;

  if (!isPositiveFiniteNumber(usdPerTarget)) {
    throw new Error("Global rates response is invalid");
  }

  rates.IRT = requireDerivedRate(usdPerTarget * usdSellIrt);
  rates.IRR = requireDerivedRate(rates.IRT * 10);
  return rates;
}

function composeIranianTargetRates(
  targetCurrency: "IRT" | "IRR",
  globalRates: NormalizedRatesResponse | undefined,
  bridge: IranianBridgeRate | undefined
): ExchangeRates {
  const usdSellIrt = requireValidBridge(bridge);
  let globalValues: ExchangeRates = {};

  if (globalRates) {
    if (!isRecord(globalRates) || typeof globalRates.base !== "string") {
      throw new Error("Global rates response is invalid");
    }

    if (globalRates.base.trim().toUpperCase() !== "USD") {
      throw new Error("Iranian target composition requires USD-based global rates");
    }

    globalValues = copyValidatedGlobalRates(globalRates);
  }

  const denominator = requireDerivedRate(
    targetCurrency === "IRT" ? usdSellIrt : usdSellIrt * 10
  );
  const rates: ExchangeRates = {};

  for (const [code, value] of Object.entries(globalValues)) {
    rates[code] = requireDerivedRate(value / denominator);
  }

  rates.USD = requireDerivedRate(1 / denominator);

  if (targetCurrency === "IRT") {
    rates.IRT = 1;
    rates.IRR = 10;
  } else {
    rates.IRR = 1;
    rates.IRT = 0.1;
  }

  return rates;
}

export function composeConversionRates(
  options: ComposeConversionRatesOptions
): ExchangeRates {
  if (typeof options.targetCurrency !== "string") {
    throw new Error("Target currency is required");
  }

  const targetCurrency = options.targetCurrency.trim().toUpperCase();

  if (!targetCurrency) {
    throw new Error("Target currency is required");
  }

  if (targetCurrency === "IRT" || targetCurrency === "IRR") {
    return composeIranianTargetRates(
      targetCurrency,
      options.globalRates,
      options.iranianBridge
    );
  }

  const globalRates = requireGlobalRates(options.globalRates);
  return composeGlobalTargetRates(
    targetCurrency,
    globalRates,
    options.iranianBridge
  );
}
