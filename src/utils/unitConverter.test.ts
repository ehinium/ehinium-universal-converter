import {
  convertUnit,
  getDefaultTargetUnit,
  resolveTargetUnit,
} from "./unitConverter";
import type { UnitCode } from "./unitTypes";

function expectClose(
  actual: number | null,
  expected: number,
  description: string
): void {
  if (actual === null || Math.abs(actual - expected) > 1e-9) {
    throw new Error(
      `${description}: expected ${expected}, received ${String(actual)}`
    );
  }
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

expectClose(convertUnit(1, "m", "ft"), 3.280839895013123, "meters to feet");
expectClose(convertUnit(1, "ft", "m"), 0.3048, "feet to meters");
expectClose(convertUnit(1, "km", "mi"), 0.621371192237334, "kilometers to miles");
expectClose(convertUnit(1, "mi", "km"), 1.609344, "miles to kilometers");
expectClose(convertUnit(1, "kg", "lb"), 2.2046226218487757, "kilograms to pounds");
expectClose(convertUnit(1, "lb", "kg"), 0.45359237, "pounds to kilograms");
expectClose(convertUnit(0, "c", "f"), 32, "Celsius to Fahrenheit");
expectClose(convertUnit(32, "f", "c"), 0, "Fahrenheit to Celsius");
expectEqual(convertUnit(1, "kg", "m"), null, "cross-category conversion");
expectEqual(convertUnit(Number.NaN, "kg", "lb"), null, "invalid amount");

const expectedDefaultTargets: Readonly<Record<UnitCode, UnitCode | null>> = {
  mm: null,
  cm: "in",
  m: "ft",
  km: "mi",
  in: null,
  ft: null,
  yd: null,
  mi: "km",
  mg: null,
  g: "oz",
  kg: "lb",
  oz: "g",
  lb: "kg",
  c: "f",
  f: "c",
};

for (const [unit, expected] of Object.entries(expectedDefaultTargets)) {
  expectEqual(
    getDefaultTargetUnit(unit as UnitCode),
    expected,
    `default target for ${unit}`
  );
}

const expectedMetricTargets: Readonly<Partial<Record<UnitCode, UnitCode>>> = {
  in: "cm",
  ft: "m",
  yd: "m",
  mi: "km",
  oz: "g",
  lb: "kg",
  f: "c",
};

for (const unit of Object.keys(expectedDefaultTargets) as UnitCode[]) {
  expectEqual(
    resolveTargetUnit(unit, "metric", "auto"),
    expectedMetricTargets[unit] ?? null,
    `metric target for ${unit}`
  );
}

const expectedImperialTargets: Readonly<Partial<Record<UnitCode, UnitCode>>> = {
  mm: "in",
  cm: "in",
  m: "ft",
  km: "mi",
  mg: "oz",
  g: "oz",
  kg: "lb",
  c: "f",
};

for (const unit of Object.keys(expectedDefaultTargets) as UnitCode[]) {
  expectEqual(
    resolveTargetUnit(unit, "imperial", "auto"),
    expectedImperialTargets[unit] ?? null,
    `imperial target for ${unit}`
  );
}

expectEqual(
  resolveTargetUnit("ft", "metric", "cm"),
  "cm",
  "exact target overrides metric system"
);
expectEqual(
  resolveTargetUnit("lb", "imperial", "kg"),
  "kg",
  "exact target overrides imperial system"
);
