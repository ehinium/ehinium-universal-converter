import type { IranianBridgeRate } from "../types/rates";

export type FetchEhiniumIranianRateOptions = {
  apiUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value > 0
  );
}

export async function fetchEhiniumIranianRate(
  options: FetchEhiniumIranianRateOptions
): Promise<IranianBridgeRate> {
  if (!isNonEmptyString(options.apiUrl)) {
    throw new Error("Ehinium Iranian rates API URL is missing");
  }

  if (!isNonEmptyString(options.token)) {
    throw new Error("Ehinium Iranian rates token is missing");
  }

  const apiUrl = options.apiUrl.trim();
  const token = options.token.trim();

  const fetchRates = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchRates(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new Error("Ehinium Iranian rates request failed");
  }

  if (!response.ok) {
    throw new Error(
      `Ehinium Iranian rates request failed with status ${response.status}`
    );
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch {
    throw new Error("Ehinium Iranian rates returned invalid JSON");
  }

  if (!isRecord(data)) {
    throw new Error("Ehinium Iranian rates response is invalid");
  }

  const rates = data.rates;
  const usd = isRecord(rates) ? rates.USD : undefined;
  const sell = isRecord(usd) ? usd.sell : undefined;

  if (
    !isPositiveFiniteNumber(data.version) ||
    data.unit !== "IRT" ||
    !isNonEmptyString(data.updatedAt) ||
    !(
      data.sourceUpdatedAt === null ||
      isNonEmptyString(data.sourceUpdatedAt)
    ) ||
    !isPositiveFiniteNumber(sell)
  ) {
    throw new Error("Ehinium Iranian rates response is invalid");
  }

  return {
    unit: "IRT",
    usdSellIrt: sell,
    updatedAt: data.updatedAt,
    sourceUpdatedAt: data.sourceUpdatedAt,
    provider: "ehinium",
  };
}
