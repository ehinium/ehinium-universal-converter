export type ExchangeRates = Record<string, number>;

export type RateProviderName = "frankfurter" | "fawaz" | "frankfurter+fawaz";

export type NormalizedRatesResponse = {
  base: string;
  date: string;
  rates: ExchangeRates;
  provider: RateProviderName;
};

export type IranianBridgeRate = {
  unit: "IRT";
  usdSellIrt: number;
  updatedAt: string;
  sourceUpdatedAt: string | null;
  provider: "ehinium";
};

export type EhiniumIranianRatesApiResponse = {
  version: number;
  unit: "IRT";
  updatedAt: string;
  sourceUpdatedAt: string | null;
  rates: {
    USD: {
      buy: number;
      sell: number;
    };
  };
};
