import { Window } from "happy-dom";
import type { ExchangeRates } from "../types/rates";
import type { UserSettings } from "../types/settings";
import { defaultSettings } from "../utils/defaultSettings";
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
} {
  const renderCalls: RenderConversionOptions[] = [];
  const rateCalls: string[] = [];

  return {
    renderCalls,
    rateCalls,
    collectTextNodesForScan: async () => [createTextNode()],
    getExchangeRates: async (targetCurrency) => {
      rateCalls.push(targetCurrency);
      return { rates };
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
  let resolveRates: (value: { rates: ExchangeRates }) => void = () => undefined;
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

  resolveRates({ rates });
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
