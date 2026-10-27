import { parseUnits } from "./unitParser";
import type { UnitCategory, UnitCode } from "./unitTypes";

type ExpectedUnit = {
  amount: number;
  unit: UnitCode;
  category: UnitCategory;
  raw?: string;
};

function expectUnits(text: string, expected: ExpectedUnit[], explicit = false): void {
  const expectsRaw = expected.some((match) => match.raw !== undefined);
  const actual = parseUnits(text, { explicit }).map(({ raw, amount, unit, category }) => ({
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
// Typed or selected by the user, a bare letter is a temperature.
expectUnits("20 c", [{ amount: 20, unit: "c", category: "temperature" }], true);
expectUnits("20 C", [{ amount: 20, unit: "c", category: "temperature" }], true);
// On a page it needs a degree sign or temperature words nearby.
expectUnits("20 C", []);
for (const temperature of ["30ºC", "30° C", "30 degrees C", "Bake at 180C", "Machine wash 30C", "Oven safe to 450F", "Waschen bei 40C", "-18C"]) {
  expectUnits(temperature, [{ amount: Number(/-?\d+/u.exec(temperature)![0]), unit: /F$/u.test(temperature) ? "f" : "c", category: "temperature" }]);
}
expectUnits("180C/350F", [{ amount: 180, unit: "c", category: "temperature" }]);
expectUnits("Operating temperature 0C to 40C", [{ amount: 0, unit: "c", category: "temperature" }]);
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
expectUnits("2 x 500 g", [{ raw: "500 g", amount: 500, unit: "g", category: "weight" }]);

// Letter-prefixed dimensions (Amazon curtain titles and size dropdowns).
expectDimension("Taupe W55 x L82 Inch 2 Panels", "W55 x L82 Inch", [55, 82], "in");
expectDimension("W 55″ x L 82″ (2 Panels)", "W 55″ x L 82″", [55, 82], "in");
expectDimension("H 30 x W 69 x D 28.5 cm", "H 30 x W 69 x D 28.5 cm", [30, 69, 28.5], "cm");
expectDimension("12 in x 18 in", "12 in x 18 in", [12, 18], "in");
// A model number ending in digits does not swallow the following size.
expectUnits('LG TV Pro 55UN711 55" LED', [{ raw: '55"', amount: 55, unit: "in", category: "length" }]);

// Fractions and mixed numbers (IKEA US, Nike size charts).
expectOneCompleteUnit('1/4”', 0.25, "in", "length");
expectOneCompleteUnit("5-1/2 in", 5.5, "in", "length");
expectOneCompleteUnit('31½"', 31.5, "in", "length");
expectOneCompleteUnit("½ inch", 0.5, "in", "length");
expectUnits('Width 41 3/8 "', [{ raw: '41 3/8 "', amount: 41.375, unit: "in", category: "length" }]);
expectDimension('Bookcase, white, 15 3/4x11x79 1/2 "', '15 3/4x11x79 1/2 "', [15.75, 11, 79.5], "in");
expectDimension('Desk, white, 41 3/8x19 5/8 "', '41 3/8x19 5/8 "', [41.375, 19.625], "in");

// Feet and inches become one value in inches.
expectOneCompleteUnit('6\'2"', 74, "in", "length");
expectOneCompleteUnit("5 ft 3 in", 63, "in", "length");
expectDimension('5\'3" x 7\'6"', '5\'3" x 7\'6"', [63, 90], "in");
expectDimension('Rug, natural, 5 \' 3 "x7 \' 7 "', '5 \' 3 "x7 \' 7 "', [63, 91], "in");
expectDimension('7 \' 10 "x10 \'', '7 \' 10 "x10 \'', [94, 120], "in");

// Ranges convert both bounds into one match.
function expectRange(text: string, raw: string, range: [number, number], unit: UnitCode): void {
  const actual = parseUnits(text).map((match) => ({ raw: match.raw, range: match.range, unit: match.unit }));
  const expected = [{ raw, range, unit }];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${JSON.stringify(text)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
expectRange("30 to 49 in", "30 to 49 in", [30, 49], "in");
expectRange("Da 26,0 a 34,9 in", "26,0 a 34,9 in", [26, 34.9], "in");
expectRange("26.0～34.9 in", "26.0～34.9 in", [26, 34.9], "in");
expectRange("For 40-65″ TV-er", "40-65″", [40, 65], "in");
expectRange("Bildestørrelse: 90″-200″", "90″-200″", [90, 200], "in");
expectRange("26″ – 391″", "26″ – 391″", [26, 391], "in");
expectRange("Støtter TV-er fra 43″ til 100″", "43″ til 100″", [43, 100], "in");
expectRange("32 Inch - 65 Inch", "32 Inch - 65 Inch", [32, 65], "in");
expectRange("Bust 34-36 in", "34-36 in", [34, 36], "in");
expectRange("12-20In", "12-20In", [12, 20], "in");
expectRange("−20 to 40 °C", "−20 to 40 °C", [-20, 40], "c");
// A unit glued to its number and then a hyphen: the same unit on both ends.
expectRange("For kids 10kg-20kg", "10kg-20kg", [10, 20], "kg");
expectRange("Strap 30cm-40cm", "30cm-40cm", [30, 40], "cm");
expectRange("Height 5ft-6ft", "5ft-6ft", [5, 6], "ft");
expectRange("Fits 30in-40in", "30in-40in", [30, 40], "in");
// momo.com.tw size filters: 至 and 到 are Chinese for "to".
expectRange("80吋至89吋", "80吋至89吋", [80, 89], "in");
expectRange("42吋到43吋", "42吋到43吋", [42, 43], "in");
expectRange("30cm至40cm", "30cm至40cm", [30, 40], "cm");

// CJK and Korean text runs straight on after a unit; a lone letter there is no unit.
expectUnits("ソファ 125cm幅", [{ raw: "125cm", amount: 125, unit: "cm", category: "length" }]);
expectUnits("长度30cm的", [{ raw: "30cm", amount: 30, unit: "cm", category: "length" }]);
expectUnits("25℃以下", [{ raw: "25℃", amount: 25, unit: "c", category: "temperature" }]);
expectUnits("30cm짜리", [{ raw: "30cm", amount: 30, unit: "cm", category: "length" }]);
expectUnits("500ml装", [{ raw: "500ml", amount: 500, unit: "ml", category: "volume" }]);
expectUnits("5g手机", []);
expectUnits("4G网络", []);
expectUnits("30cmwide", []);
expectUnits("3in1充電器", []);

// Words for inch in other languages and scripts.
for (const [text, raw, amount] of [
  ["テレビ55インチ液晶", "55インチ", 55],
  ["AQUOS 55V型", "55V型", 55],
  ["(55인치)", "55인치", 55],
  ["70吋", "70吋", 70],
  ["55英寸", "55英寸", 55],
  ["تلویزیون 55 اینچ", "55 اینچ", 55],
  ["۶.۳ اینچی", "۶.۳ اینچی", 6.3],
  ["55 بوصة", "55 بوصة", 55],
  ["iFFALCON 55 İnç", "55 İnç", 55],
  ["55 inç", "55 inç", 55],
  ["Fernseher 55 Zoll", "55 Zoll", 55],
  ["Smart TV 55 Pulgadas", "55 Pulgadas", 55],
  ["Smart TV 55 pollici", "55 pollici", 55],
  ["Telewizor 50 cali", "50 cali", 50],
  ["Smart TV 55 polegadas", "55 polegadas", 55],
] as const) {
  expectUnits(text, [{ raw, amount, unit: "in", category: "length" }]);
}
expectUnits("2型糖尿病", []);

// Fluid ounces are volume; plain ounces stay weight unless the text is about a liquid.
expectUnits("16 fl oz", [{ raw: "16 fl oz", amount: 16, unit: "floz", category: "volume" }]);
expectUnits("Eau de Parfum Spray 3.4 oz", [{ raw: "3.4 oz", amount: 3.4, unit: "floz", category: "volume" }]);
// Only the phrase around the size decides: other sentences, a state or a time zone do not.
expectUnits("Ships from Tampa, FL. Net weight 12 oz", [{ raw: "12 oz", amount: 12, unit: "oz", category: "weight" }]);
expectUnits("12 oz ribeye, order by 5pm EDT", [{ raw: "12 oz", amount: 12, unit: "oz", category: "weight" }]);
expectUnits("Net Wt 16 oz (454 g). Mix with 250 ml of milk.", [
  { raw: "16 oz", amount: 16, unit: "oz", category: "weight" },
  { raw: "454 g", amount: 454, unit: "g", category: "weight" },
  { raw: "250 ml", amount: 250, unit: "ml", category: "volume" },
]);
expectUnits("Coffee 12 oz bag", [{ raw: "12 oz", amount: 12, unit: "oz", category: "weight" }]);
expectUnits("4x 100 ml", [{ raw: "100 ml", amount: 100, unit: "ml", category: "volume" }]);

// Measurement context makes a spaced "in" an inch.
expectOneCompleteUnit("55 in", 55, "in", "length");
expectUnits("55 in TV", [{ raw: "55 in", amount: 55, unit: "in", category: "length" }]);
expectUnits("3.5 in wide", [{ raw: "3.5 in", amount: 3.5, unit: "in", category: "length" }]);
expectUnits("Fits 10 in. tablets", [{ raw: "10 in", amount: 10, unit: "in", category: "length" }]);
expectUnits("-5 °C", [{ raw: "-5 °C", amount: -5, unit: "c", category: "temperature" }]);

for (const falsePositive of [
  // The English (or German) preposition "in" after a number.
  "Nr. 157.777 in Fashion",
  "#487 in Fashion",
  "Top 100 in Fashion",
  "4 in 1",
  "Area rug 5x8 in camel",
  "$71.08 in CT Money",
  "11 In Stock",
  "0 In Stock",
  // Network generations, sizes and quantities in another letter case.
  "5G phone",
  "4G LTE",
  // Model names and cents with a bare C or F.
  "Xiaomi Redmi 15C 4G 256GB Storage",
  "Redmi 15C tempered glass",
  "iPhone 5C",
  "Class 5C",
  "Model 5F",
  "Only 99c",
  "Rotates 360 degrees Clockwise",
  "5M views",
  "2 L bottle",
  // Labels without a unit, dates, negative lengths and zero.
  "Blackout Curtains 52W x 84L",
  "Size 32 W",
  "12/05/2026",
  "-5 kg",
  "0 kg",
  "3-in-1",
  "Seats 10-12 F",
  "Apt 3-4 F",
  "2-in-1 laptop",
  "30cm-wide strap",
  "55-inch-wide stand",
  "4G-5G modem",
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
