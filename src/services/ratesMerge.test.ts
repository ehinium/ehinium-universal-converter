import { globalProviderFiatCurrencies } from "../data/currencies";
import type { NormalizedRatesResponse } from "../types/rates";
import { getFawazRates } from "./fawaz";
import { getFrankfurterRates } from "./frankfurter";
import { getExchangeRates, mergeRateResponses } from "./rates";

function expect(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

async function expectRejects(
  action: () => Promise<unknown>,
  expectedMessage: string,
  description: string
): Promise<void> {
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(caught instanceof Error, `${description}: expected an Error`);
  expectEqual(caught.message, expectedMessage, description);
}

const primary: NormalizedRatesResponse = {
  base: "USD",
  date: "2026-07-16",
  provider: "frankfurter",
  rates: { USD: 1, EUR: 0.86 },
};
const fallback: NormalizedRatesResponse = {
  base: "USD",
  date: "2026-07-14",
  provider: "fawaz",
  rates: { USD: 1, EUR: 0.85, VED: 722.75 },
};
const merged = mergeRateResponses(primary, fallback);

if (
  merged.provider !== "frankfurter+fawaz" ||
  merged.date !== "2026-07-14" ||
  merged.rates.EUR !== 0.86 ||
  merged.rates.VED !== 722.75
) {
  throw new Error(`Unexpected merged rate response: ${JSON.stringify(merged)}`);
}

let baseMismatchRejected = false;
try {
  mergeRateResponses(primary, { ...fallback, base: "EUR" });
} catch {
  baseMismatchRejected = true;
}

if (!baseMismatchRejected) {
  throw new Error("Merging different rate bases must fail");
}

console.log("Partial primary rates are supplemented by fallback rates.");

const originalFetch = globalThis.fetch;

try {
  let providerFetchCalls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      providerFetchCalls += 1;
      const url = String(input);

      if (url.includes("frankfurter")) {
        return jsonResponse([
          { date: "2026-07-19", base: "USD", quote: "EUR", rate: 0.92 },
          { date: "2026-07-19", base: "USD", quote: "IRR", rate: 42000 },
          { date: "2026-07-19", base: "USD", quote: "IRT", rate: 4200 },
        ]);
      }

      return jsonResponse({
        date: "2026-07-19",
        usd: { eur: 0.92, irr: 42000, irt: 4200 },
      });
    },
  });

  const frankfurterFiltered = await getFrankfurterRates("USD");
  expectEqual(frankfurterFiltered.rates.USD, 1, "Frankfurter base rate remains one");
  expectEqual(frankfurterFiltered.rates.EUR, 0.92, "Frankfurter global rate remains available");
  expectEqual(frankfurterFiltered.rates.IRR, undefined, "Frankfurter IRR is filtered");
  expectEqual(frankfurterFiltered.rates.IRT, undefined, "Frankfurter IRT is filtered");
  expectEqual(frankfurterFiltered.provider, "frankfurter", "Frankfurter provider label");

  const fawazFiltered = await getFawazRates("USD");
  expectEqual(fawazFiltered.rates.USD, 1, "Fawaz base rate remains one");
  expectEqual(fawazFiltered.rates.EUR, 0.92, "Fawaz global rate remains available");
  expectEqual(fawazFiltered.rates.IRR, undefined, "Fawaz IRR is filtered");
  expectEqual(fawazFiltered.rates.IRT, undefined, "Fawaz IRT is filtered");
  expectEqual(fawazFiltered.provider, "fawaz", "Fawaz provider label");
  expectEqual(providerFetchCalls, 2, "direct provider request count");

  const completeFrankfurterRates = globalProviderFiatCurrencies
    .filter((currency) => currency.code !== "USD")
    .map((currency, index) => ({
      date: "2026-07-19",
      base: "USD",
      quote: currency.code,
      rate: index + 2,
    }));
  let supplementalCalls = 0;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("frankfurter")) {
        return jsonResponse(completeFrankfurterRates);
      }

      supplementalCalls += 1;
      throw new Error("Fawaz must not be needed for complete global rates");
    },
  });

  const completeResult = await getExchangeRates("USD", { forceRefresh: true });
  expectEqual(supplementalCalls, 0, "global completeness excludes IRT and IRR");
  expectEqual(completeResult.provider, "frankfurter", "complete primary provider label");
  expectEqual(completeResult.rates.USD, 1, "complete response base rate remains one");

  const fawazValues = Object.fromEntries(
    globalProviderFiatCurrencies
      .filter((currency) => currency.code !== "USD")
      .map((currency, index) => [currency.code.toLowerCase(), index + 3])
  );
  const expectedSupplementalEur = fawazValues.eur;
  supplementalCalls = 0;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("frankfurter")) {
        return jsonResponse(
          completeFrankfurterRates.filter((entry) => entry.quote !== "EUR")
        );
      }

      supplementalCalls += 1;
      return jsonResponse({ date: "2026-07-18", usd: fawazValues });
    },
  });

  const supplementedResult = await getExchangeRates("USD", {
    forceRefresh: true,
  });
  expectEqual(supplementalCalls, 1, "missing global currency triggers supplementation");
  expectEqual(supplementedResult.provider, "frankfurter+fawaz", "supplemented provider label");
  expectEqual(supplementedResult.date, "2026-07-18", "merge date semantics remain unchanged");
  expectEqual(supplementedResult.rates.EUR, expectedSupplementalEur, "Fawaz supplies missing global rate");

  let iranianBaseFetchCalls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      iranianBaseFetchCalls += 1;
      throw new Error("Iranian base must fail before fetch");
    },
  });
  const iranianBaseError = "Iranian currencies require the Iranian conversion bridge";
  await expectRejects(
    () => getExchangeRates("IRT"),
    iranianBaseError,
    "IRT base rejection"
  );
  await expectRejects(
    () => getExchangeRates("IRR"),
    iranianBaseError,
    "IRR base rejection"
  );
  expectEqual(iranianBaseFetchCalls, 0, "Iranian bases fail before provider fetch");
} finally {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
}
