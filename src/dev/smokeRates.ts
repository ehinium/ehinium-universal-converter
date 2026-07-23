import { composeConversionRates } from "../services/conversionRates";
import type {
  ExchangeRates,
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";

export const deterministicSmokeIranianBridgeRate: IranianBridgeRate = {
  unit: "IRT",
  usdSellIrt: 200_000,
  updatedAt: "deterministic-smoke-rate",
  sourceUpdatedAt: null,
  provider: "ehinium",
};

export function composeSmokeConversionRates(
  targetCurrency: string,
  globalRates: NormalizedRatesResponse
): ExchangeRates {
  return composeConversionRates({
    targetCurrency,
    globalRates,
    iranianBridge: deterministicSmokeIranianBridgeRate,
  });
}
