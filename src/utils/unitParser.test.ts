import { parseUnits } from "./unitParser";
import type { UnitCategory, UnitCode } from "./unitTypes";

type ExpectedUnit = {
  amount: number;
  unit: UnitCode;
  category: UnitCategory;
  raw?: string;
};

function expectUnits(text: string, expected: ExpectedUnit[]): void {
  const expectsRaw = expected.some((match) => match.raw !== undefined);
  const actual = parseUnits(text).map(({ raw, amount, unit, category }) => ({
    ...(expectsRaw ? { raw } : {}),
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

function expectOneCompleteUnit(
  text: string,
  amount: number,
  unit: UnitCode,
  category: UnitCategory
): void {
  expectUnits(text, [{ raw: text, amount, unit, category }]);
}

expectUnits("10 kg", [{ amount: 10, unit: "kg", category: "weight" }]);
expectUnits("80 KG", [{ amount: 80, unit: "kg", category: "weight" }]);
expectUnits("10kg", [{ amount: 10, unit: "kg", category: "weight" }]);
expectUnits("5.5 miles", [{ amount: 5.5, unit: "mi", category: "length" }]);
expectUnits("180 cm", [{ amount: 180, unit: "cm", category: "length" }]);
expectUnits("180 CM", [{ amount: 180, unit: "cm", category: "length" }]);
expectUnits("32°F", [{ amount: 32, unit: "f", category: "temperature" }]);
expectUnits("68 °F", [{ amount: 68, unit: "f", category: "temperature" }]);
expectUnits("20 c", [{ amount: 20, unit: "c", category: "temperature" }]);
expectUnits("20 C", [{ amount: 20, unit: "c", category: "temperature" }]);
expectUnits("20 °c", [{ amount: 20, unit: "c", category: "temperature" }]);
expectUnits("20 °C", [{ amount: 20, unit: "c", category: "temperature" }]);
expectUnits("12 inches and 3 pounds", [
  { amount: 12, unit: "in", category: "length" },
  { amount: 3, unit: "lb", category: "weight" },
]);

expectOneCompleteUnit("10 000 kg", 10000, "kg", "weight");
expectOneCompleteUnit("10\u00a0000 kg", 10000, "kg", "weight");
expectOneCompleteUnit("10\u202f000 kg", 10000, "kg", "weight");
expectOneCompleteUnit("10\u2009000 kg", 10000, "kg", "weight");
expectOneCompleteUnit("10'000 kg", 10000, "kg", "weight");
expectOneCompleteUnit("10’000 kg", 10000, "kg", "weight");
expectOneCompleteUnit("1,234.5 km", 1234.5, "km", "length");
expectOneCompleteUnit("1.234,5 km", 1234.5, "km", "length");
expectOneCompleteUnit("1 234,5 km", 1234.5, "km", "length");

function expectDimension(
  text: string,
  raw: string,
  dimensions: number[],
  unit: UnitCode
): void {
  const actual = parseUnits(text).map((match) => ({
    raw: match.raw,
    dimensions: match.dimensions,
    unit: match.unit,
  }));
  const expected = [{ raw, dimensions, unit }];

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${JSON.stringify(text)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

// Amazon titles and size swatches reported by users.
expectOneCompleteUnit("144-Inch", 144, "in", "length");
expectOneCompleteUnit("10-ft", 10, "ft", "length");
expectOneCompleteUnit('70"', 70, "in", "length");
expectOneCompleteUnit("70″", 70, "in", "length");
expectOneCompleteUnit("70''", 70, "in", "length");
expectOneCompleteUnit("6'", 6, "ft", "length");
expectOneCompleteUnit("6′", 6, "ft", "length");
expectUnits('70" (Round)', [{ raw: '70"', amount: 70, unit: "in", category: "length" }]);
expectDimension("50x144-Inch Oval Taffeta Tablecloth", "50x144-Inch", [50, 144], "in");
expectDimension("72x120-Inch Oval Polyester", "72x120-Inch", [72, 120], "in");
expectDimension('Tablecloth, Red - 60" W x 84" L Oval', '60" W x 84" L', [60, 84], "in");
expectDimension('Tablecloth, Cranberry - 60"W x 84"L Oval', '60"W x 84"L', [60, 84], "in");
expectDimension("Damask 60 x 102 Inch Oval Tablecloth", "60 x 102 Inch", [60, 102], "in");
expectDimension("Table Cloth 60x84 Inch Beige", "60x84 Inch", [60, 84], "in");
expectDimension('52" x 52" (Square)', '52" x 52"', [52, 52], "in");
expectDimension("84″ × 60″", "84″ × 60″", [84, 60], "in");
expectDimension("6' x 9' rug", "6' x 9'", [6, 9], "ft");
expectDimension("20 x 30 x 40 cm box", "20 x 30 x 40 cm", [20, 30, 40], "cm");
// Only length units form dimensions; other units keep the single trailing match.
expectUnits("5 x 3 kg", [{ raw: "3 kg", amount: 3, unit: "kg", category: "weight" }]);

for (const falsePositive of [
  "3-in-1",
  '"iPhone 15"',
  "“Season 2”",
  "the 90's",
  "BN59-01312G",
  "Q70",
  "iPhone 15",
  "Rated 4.8 stars",
  "Save 20%",
  "Product 5%",
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
