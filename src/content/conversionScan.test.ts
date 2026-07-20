import { Window } from "happy-dom";
import type {
  ExchangeRates,
  IranianBridgeRate,
  NormalizedRatesResponse,
} from "../types/rates";
import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";
import { parseCurrencies } from "../utils/currencyParser";
import { formatConvertedCurrency } from "../utils/displayFormatting";
import {
  scanConversionRoots,
  type ConversionScanDependencies,
} from "./conversionScan";
import type { RenderConversionOptions } from "./domRenderer";

const window = new Window();

Object.assign(globalThis, {
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Text: window.Text,
});

const rates: ExchangeRates = {
  AED: 3.67,
  EUR: 0.92,
  USD: 1,
};

const iranianBridge: IranianBridgeRate = {
  unit: "IRT",
  usdSellIrt: 200000,
  updatedAt: "2026-01-01T00:00:00Z",
  sourceUpdatedAt: null,
  provider: "ehinium",
};

function normalizedRates(
  base: string,
  exchangeRates: ExchangeRates
): NormalizedRatesResponse {
  return {
    base,
    date: "2026-01-01",
    rates: exchangeRates,
    provider: "frankfurter",
  };
}

function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    ...defaultSettings,
    enabled: true,
    converterMode: "everything",
    targetCurrency: "USD",
    ...overrides,
  };
}

{
  const root = document.createElement("div");
  root.innerHTML = `
    <span class="a-price">
      <span class="a-offscreen">AED 118.94</span>
      <span aria-hidden="true">
        <span class="a-price-symbol">AED</span>
        <span class="a-price-whole">118</span>
        <span class="a-price-fraction">94</span>
      </span>
    </span>
  `;
  document.body.append(root);
  const dependencies = createDependencies({
    collectTextNodesForScan: async () => [],
  });
  const result = await scanConversionRoots(
    { reason: "mutation", roots: [root] },
    settings({ converterMode: "currencies" }),
    dependencies
  );

  expectEqual(result.renderedCount, 1, "grouped-only root rendered count");
  expectEqual(dependencies.rateCalls.length, 1, "grouped-only root loads rates");
  expectEqual(dependencies.renderCalls.length, 1, "grouped-only root reaches renderer");
  expectEqual(dependencies.renderCalls[0]?.scanRoots?.[0], root, "grouped-only render receives bounded roots");
  root.remove();
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

function createTextNode(): Text {
  return document.createTextNode("100 EUR and 10 kg");
}

function createDependencies(
  options: Partial<ConversionScanDependencies> = {}
): ConversionScanDependencies & {
  renderCalls: RenderConversionOptions[];
  rateCalls: string[];
  bridgeCalls: number[];
} {
  const renderCalls: RenderConversionOptions[] = [];
  const rateCalls: string[] = [];
  const bridgeCalls: number[] = [];

  return {
    renderCalls,
    rateCalls,
    bridgeCalls,
    collectTextNodesForScan: async () => [createTextNode()],
    getExchangeRates: async (targetCurrency) => {
      rateCalls.push(targetCurrency);
      return normalizedRates(targetCurrency, rates);
    },
    requestIranianBridgeRate: async () => {
      bridgeCalls.push(1);
      return iranianBridge;
    },
    renderConversions: (_textNodes, renderOptions) => {
      renderCalls.push(renderOptions);
      return 1;
    },
    ...options,
  };
}

{
  const dependencies = createDependencies();
  const result = await scanConversionRoots(
    { reason: "initial", roots: [] },
    settings({ converterMode: "currencies" }),
    dependencies
  );

  expectEqual(result.renderedCount, 1, "currencies mode rendered count");
  expectEqual(dependencies.rateCalls.length, 1, "currencies mode loads rates");
  expectEqual(
    dependencies.bridgeCalls.length,
    0,
    "global-only currencies skip bridge"
  );
  expectEqual(dependencies.renderCalls.length, 1, "currencies mode render calls");
  expectEqual(
    dependencies.renderCalls[0]?.renderCurrencies,
    true,
    "currencies mode renders currencies"
  );
  expectEqual(
    dependencies.renderCalls[0]?.renderUnits,
    false,
    "currencies mode skips units"
  );
}

{
  const dependencies = createDependencies();
  const result = await scanConversionRoots(
    { reason: "initial", roots: [] },
    settings({ converterMode: "units" }),
    dependencies
  );

  expectEqual(result.renderedCount, 1, "units mode rendered count");
  expectEqual(dependencies.rateCalls.length, 0, "units mode skips rates");
  expectEqual(dependencies.bridgeCalls.length, 0, "units mode skips bridge");
  expectEqual(dependencies.renderCalls.length, 1, "units mode render calls");
  expectEqual(
    dependencies.renderCalls[0]?.renderCurrencies,
    false,
    "units mode skips currencies"
  );
  expectEqual(
    dependencies.renderCalls[0]?.renderUnits,
    true,
    "units mode renders units"
  );
}

{
  let resolveRates: (value: NormalizedRatesResponse) => void = () => undefined;
  const dependencies = createDependencies({
    getExchangeRates: () =>
      new Promise((resolve) => {
        resolveRates = resolve;
      }),
  });
  const scan = scanConversionRoots(
    { reason: "initial", roots: [] },
    settings({ converterMode: "everything" }),
    dependencies
  );

  await Promise.resolve();
  await Promise.resolve();

  expectEqual(
    dependencies.renderCalls[0]?.renderUnits,
    true,
    "everything mode renders units before rates resolve"
  );
  expectEqual(
    dependencies.renderCalls[0]?.renderCurrencies,
    false,
    "everything mode first render skips currencies"
  );

  resolveRates(normalizedRates("USD", rates));
  await scan;
}

{
  const dependencies = createDependencies({
    getExchangeRates: async () => {
      throw new Error("rates unavailable");
    },
  });
  const result = await scanConversionRoots(
    { reason: "initial", roots: [] },
    settings({ converterMode: "everything" }),
    dependencies
  );

  expectEqual(
    result.renderedCount,
    1,
    "everything mode keeps unit render after rate failure"
  );
  expectEqual(
    dependencies.renderCalls.length,
    1,
    "everything mode does not render currencies after rate failure"
  );
}

{
  const dependencies = createDependencies();
  await scanConversionRoots(
    { reason: "initial", roots: [] },
    settings({ converterMode: "everything" }),
    dependencies
  );

  const unitRenderCount = dependencies.renderCalls.filter(
    (renderOptions) => renderOptions.renderUnits === true
  ).length;

  expectEqual(unitRenderCount, 1, "everything mode renders each unit once");
  expectEqual(
    dependencies.renderCalls.length,
    2,
    "everything mode renders units then currencies"
  );
}

type RecordedConversion = {
  amount: number;
  currency: string;
  converted: number;
};

type ScenarioOptions = {
  globalFailure?: boolean;
  bridgeFailure?: boolean;
  converterMode?: UserSettings["converterMode"];
};

async function runCurrencyScenario(
  inputs: readonly string[],
  targetCurrency: string,
  options: ScenarioOptions = {}
): Promise<{
  result: Awaited<ReturnType<typeof scanConversionRoots>>;
  rateCalls: string[];
  bridgeCalls: number;
  conversions: RecordedConversion[];
  currencyRenderCalls: number;
  unitRenderCalls: number;
}> {
  const textNodes = inputs.map((input) => document.createTextNode(input));
  const rateCalls: string[] = [];
  const conversions: RecordedConversion[] = [];
  let bridgeCalls = 0;
  let currencyRenderCalls = 0;
  let unitRenderCalls = 0;

  const result = await scanConversionRoots(
    { reason: "initial", roots: [] },
    settings({
      targetCurrency,
      converterMode: options.converterMode ?? "currencies",
    }),
    {
      collectTextNodesForScan: async () => textNodes,
      getExchangeRates: async (baseCurrency) => {
        rateCalls.push(baseCurrency);

        if (options.globalFailure) {
          throw new Error("global rates unavailable");
        }

        if (baseCurrency === "USD") {
          return normalizedRates("USD", {
            USD: 1,
            EUR: 0.8,
            GBP: 0.5,
          });
        }

        if (baseCurrency === "EUR") {
          return normalizedRates("EUR", {
            EUR: 1,
            USD: 1.25,
            GBP: 0.625,
          });
        }

        throw new Error(`unexpected global base ${baseCurrency}`);
      },
      requestIranianBridgeRate: async () => {
        bridgeCalls += 1;

        if (options.bridgeFailure) {
          throw new Error("Iranian rates unavailable");
        }

        return iranianBridge;
      },
      renderConversions: (nodes, renderOptions) => {
        if (renderOptions.renderUnits) {
          unitRenderCalls += 1;
          return inputs.some((input) => input.includes("kg")) ? 1 : 0;
        }

        if (!renderOptions.renderCurrencies) {
          return 0;
        }

        currencyRenderCalls += 1;
        let rendered = 0;

        for (const node of nodes) {
          for (const match of parseCurrencies(node.textContent ?? "")) {
            if (match.currency === targetCurrency) {
              continue;
            }

            const converted = renderOptions.convertAmount(match);
            if (converted === null || !Number.isFinite(converted)) {
              continue;
            }

            conversions.push({
              amount: match.amount,
              currency: match.currency,
              converted,
            });
            rendered += 1;
          }
        }

        return rendered;
      },
    }
  );

  return {
    result,
    rateCalls,
    bridgeCalls,
    conversions,
    currencyRenderCalls,
    unitRenderCalls,
  };
}

function expectConversion(
  scenario: Awaited<ReturnType<typeof runCurrencyScenario>>,
  currency: string,
  expected: number,
  description: string
): void {
  const conversion = scenario.conversions.find(
    (candidate) => candidate.currency === currency
  );

  const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-12);

  if (!conversion || Math.abs(conversion.converted - expected) > tolerance) {
    throw new Error(
      `${description}: expected ${expected}, received ${String(
        conversion?.converted
      )}`
    );
  }
}

{
  const scenario = await runCurrencyScenario(["EUR 80"], "USD");
  expectConversion(scenario, "EUR", 100, "global-only conversion");
  expectEqual(scenario.rateCalls.join(","), "USD", "global-only rate base");
  expectEqual(scenario.bridgeCalls, 0, "global-only bridge calls");
}

{
  const scenario = await runCurrencyScenario(["USD 100"], "IRT");
  const converted = scenario.conversions[0]?.converted;
  expectEqual(
    converted === undefined
      ? null
      : formatConvertedCurrency(converted, "IRT"),
    "20,000,000 IRT",
    "automatic conversion badge IRT display policy"
  );
}

{
  const scenario = await runCurrencyScenario(["10 kg"], "USD", {
    converterMode: "units",
  });
  expectEqual(scenario.rateCalls.length, 0, "unit-only global calls");
  expectEqual(scenario.bridgeCalls, 0, "unit-only bridge calls");
  expectEqual(scenario.unitRenderCalls, 1, "unit-only render calls");
}

for (const pair of [
  ["USD 100", "IRT", 20000000, "USD", "USD to IRT"],
  ["USD 100", "IRR", 200000000, "USD", "USD to IRR"],
  ["IRT 20000000", "USD", 100, "IRT", "IRT to USD"],
  ["IRR 200000000", "USD", 100, "IRR", "IRR to USD"],
] as const) {
  const [input, target, expected, source, description] = pair;
  const scenario = await runCurrencyScenario([input], target);
  expectConversion(scenario, source, expected, description);
  expectEqual(scenario.rateCalls.length, 0, `${description} global calls`);
  expectEqual(scenario.bridgeCalls, 1, `${description} bridge calls`);
}

for (const pair of [
  ["EUR 100", "IRT", 25000000, "EUR", "USD", "EUR to IRT"],
  ["EUR 100", "IRR", 250000000, "EUR", "USD", "EUR to IRR"],
  ["IRT 25000000", "EUR", 100, "IRT", "EUR", "IRT to EUR"],
  ["IRR 250000000", "EUR", 100, "IRR", "EUR", "IRR to EUR"],
] as const) {
  const [input, target, expected, source, base, description] = pair;
  const scenario = await runCurrencyScenario([input], target);
  expectConversion(scenario, source, expected, description);
  expectEqual(scenario.rateCalls.join(","), base, `${description} global base`);
  expectEqual(scenario.bridgeCalls, 1, `${description} bridge calls`);
}

for (const pair of [
  ["IRT 100", "IRR", 1000, "IRT", "IRT to IRR"],
  ["IRR 1000", "IRT", 100, "IRR", "IRR to IRT"],
] as const) {
  const [input, target, expected, source, description] = pair;
  const scenario = await runCurrencyScenario([input], target, {
    globalFailure: true,
    bridgeFailure: true,
  });
  expectConversion(scenario, source, expected, description);
  expectEqual(scenario.rateCalls.length, 0, `${description} global calls`);
  expectEqual(scenario.bridgeCalls, 0, `${description} bridge calls`);
}

{
  const scenario = await runCurrencyScenario(
    ["USD 100", "USD 200", "USD 300"],
    "IRT"
  );
  expectEqual(scenario.bridgeCalls, 1, "multiple USD prices share bridge");
  expectEqual(scenario.rateCalls.length, 0, "multiple USD prices skip global");
  expectEqual(scenario.conversions.length, 3, "multiple USD prices convert once");
  expectEqual(scenario.currencyRenderCalls, 1, "multiple prices render once");
}

{
  const scenario = await runCurrencyScenario(
    ["EUR 100", "GBP 100", "EUR 200"],
    "IRT"
  );
  expectEqual(
    scenario.rateCalls.join(","),
    "USD",
    "mixed globals share USD-base rates"
  );
  expectEqual(scenario.bridgeCalls, 1, "mixed globals share bridge");
  expectEqual(scenario.conversions.length, 3, "mixed globals all convert");
}

{
  const scenario = await runCurrencyScenario(
    ["GBP 62.5", "IRT 25000000", "IRR 250000000"],
    "EUR"
  );
  expectEqual(
    scenario.rateCalls.join(","),
    "EUR",
    "mixed global and Iranian sources share EUR rates"
  );
  expectEqual(scenario.bridgeCalls, 1, "mixed sources share bridge");
  expectEqual(scenario.conversions.length, 3, "mixed sources all convert");
}

{
  const scenario = await runCurrencyScenario(
    ["GBP 62.5", "IRT 25000000", "IRR 250000000"],
    "EUR",
    { bridgeFailure: true }
  );
  expectConversion(
    scenario,
    "GBP",
    100,
    "bridge failure preserves global conversion"
  );
  expectEqual(
    scenario.conversions.length,
    1,
    "bridge failure skips only Iranian matches"
  );
  expectEqual(scenario.rateCalls.length, 1, "bridge failure reuses global rates");
  expectEqual(scenario.bridgeCalls, 1, "bridge failure is requested once");
}

{
  const scenario = await runCurrencyScenario(
    ["IRT 100", "EUR 100", "10 kg"],
    "IRR",
    {
      converterMode: "everything",
      globalFailure: true,
      bridgeFailure: true,
    }
  );
  expectConversion(
    scenario,
    "IRT",
    1000,
    "dependency failures preserve local Iranian conversion"
  );
  expectEqual(scenario.conversions.length, 1, "failed global match is skipped");
  expectEqual(scenario.unitRenderCalls, 1, "dependency failures preserve units");
  expectEqual(scenario.result.renderedCount, 2, "local and unit render count");
}

for (const [input, source, expected, description] of [
  ["TMN 200000", "IRT", 1, "TMN alias"],
  ["تومانء ۲۰۰۰۰۰", "IRT", 1, "decorated Toman alias"],
  ["ریالء ۲۰۰۰۰۰۰", "IRR", 1, "decorated Rial alias"],
] as const) {
  const scenario = await runCurrencyScenario([input], "USD");
  expectConversion(scenario, source, expected, description);
  expectEqual(scenario.bridgeCalls, 1, `${description} bridge call`);
  expectEqual(scenario.rateCalls.length, 0, `${description} global calls`);
}

{
  const scenario = await runCurrencyScenario(["IRT 100"], "IRT");
  expectEqual(scenario.rateCalls.length, 0, "same IRT skips global calls");
  expectEqual(scenario.bridgeCalls, 0, "same IRT skips bridge calls");
  expectEqual(scenario.conversions.length, 0, "same IRT remains skipped");
  expectEqual(scenario.currencyRenderCalls, 0, "same IRT skips currency render");
}
