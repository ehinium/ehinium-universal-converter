import { parseUnits } from "./unitParser";
import type { UnitCategory, UnitCode } from "./unitTypes";

type ExpectedUnit = {
  amount: number;
  unit: UnitCode;
  category: UnitCategory;
};

function expectUnits(text: string, expected: ExpectedUnit[]): void {
  const actual = parseUnits(text).map(({ amount, unit, category }) => ({
    amount,
    unit,
    category,
  }));

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${JSON.stringify(text)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

expectUnits("10 kg", [{ amount: 10, unit: "kg", category: "weight" }]);
expectUnits("10kg", [{ amount: 10, unit: "kg", category: "weight" }]);
expectUnits("5.5 miles", [{ amount: 5.5, unit: "mi", category: "length" }]);
expectUnits("180 cm", [{ amount: 180, unit: "cm", category: "length" }]);
expectUnits("32°F", [{ amount: 32, unit: "f", category: "temperature" }]);
expectUnits("20 °C", [{ amount: 20, unit: "c", category: "temperature" }]);
expectUnits("12 inches and 3 pounds", [
  { amount: 12, unit: "in", category: "length" },
  { amount: 3, unit: "lb", category: "weight" },
]);

for (const falsePositive of [
  "BN59-01312G",
  "Q70",
  "iPhone 15",
  "Rated 4.8 stars",
  "Save 20%",
  "$100",
  "USD 100",
  "<style>.card { margin: 10 cm; }</style>",
  "<code>height: 180 cm</code>",
  "<pre>weight: 10 kg</pre>",
  "```css\nmargin: 10 cm;\n```",
  "`width: 10 cm`",
]) {
  expectUnits(falsePositive, []);
}
