import { Window } from "happy-dom";
import {
  copyManualConversion,
  formatManualConversionInput,
} from "./manualConversion";

const window = new Window();

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: window.navigator,
});

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

for (const [input, expected] of [
  ["10000000irr", "10,000,000 IRR"],
  ["10000000IRR", "10,000,000 IRR"],
  ["1234567.89usd", "1,234,567.89 USD"],
  ["10000kg", "10,000 kg"],
  ["180CM", "180 cm"],
  ["20°c", "20 °C"],
  ["random text", "random text"],
  ["1000", "1000"],
  ["1000.", "1000."],
  ["eur", "eur"],
  ["1000 e", "1000 e"],
] as const) {
  expectEqual(
    formatManualConversionInput(input),
    expected,
    `manual input formatter ${input}`
  );
}

let copiedValue: string | null = null;

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText(value: string): Promise<void> {
      copiedValue = value;
      return Promise.resolve();
    },
  },
});

expectEqual(
  await copyManualConversion("$4.63"),
  true,
  "manual copy success"
);
expectEqual(copiedValue, "$4.63", "manual copied converted value");

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText(): Promise<void> {
      return Promise.reject(new Error("Clipboard unavailable"));
    },
  },
});

expectEqual(
  await copyManualConversion("22 lb"),
  false,
  "manual copy failure"
);
