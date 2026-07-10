import {
  formatConvertedCurrency,
  formatConvertedUnit,
} from "./displayFormatting";

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

for (const [amount, expected] of [
  [2372.3, "$2,372.30"],
  [7.29, "$7.29"],
  [0.2456, "$0.2456"],
  [0.004812, "$0.004812"],
  [1234567.8, "$1,234,567.80"],
] as const) {
  expectEqual(
    formatConvertedCurrency(amount, "USD"),
    expected,
    `converted currency ${amount}`
  );
}

for (const [amount, unit, expected] of [
  [25.4, "cm", "25.4 cm"],
  [1.52, "m", "1.52 m"],
  [81.65, "kg", "81.65 kg"],
  [0.0045, "km", "0.0045 km"],
  [10000, "kg", "10,000 kg"],
] as const) {
  expectEqual(
    formatConvertedUnit(amount, unit),
    expected,
    `converted unit ${amount}`
  );
}
