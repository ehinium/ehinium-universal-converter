import { fiatCurrencies } from "../data/currencies";
import { parseCurrencies } from "../utils/currencyParser";
import { generateCurrencyTestMatrix } from "./testMatrix";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const matrix = generateCurrencyTestMatrix();
const ids = new Set(matrix.map((testCase) => testCase.id));
const coveredCurrencies = new Set(matrix.map((testCase) => testCase.currency).filter(Boolean));
const formatIds = new Set(matrix.map((testCase) => testCase.formatId));

assert(ids.size === matrix.length, "Generated smoke-test IDs must be unique");
assert(
  coveredCurrencies.size === fiatCurrencies.length,
  `Expected all ${fiatCurrencies.length} metadata currencies, covered ${coveredCurrencies.size}`
);

for (const requiredFormat of [
  "iso-prefix",
  "iso-suffix",
  "iso-prefix-compact",
  "iso-suffix-compact",
  "iso-lowercase",
  "iso-mixed-case",
  "european",
  "space-grouping",
  "nbsp-grouping",
  "nnbsp-grouping",
  "apostrophe-grouping",
  "indian-grouping",
  "leading-decimal",
  "accounting-negative",
  "range",
  "multiple-prices",
  "persian-digits",
  "arabic-indic-digits",
  "mixed-script",
  "rtl",
  "ltr-in-rtl",
]) {
  assert(formatIds.has(requiredFormat), `Missing required generated format: ${requiredFormat}`);
}

for (const testCase of matrix) {
  assert(testCase.sourceText.length > 0, `${testCase.id} has empty sourceText`);
  assert(testCase.formatId.length > 0, `${testCase.id} has empty formatId`);
  assert(testCase.category.length > 0, `${testCase.id} has empty category`);

  if (testCase.expectedBehavior === "convert") {
    assert(testCase.expectedSourceCurrency, `${testCase.id} is convertible without a source currency`);
    assert(testCase.expectedMatchCount !== undefined, `${testCase.id} is convertible without a match count`);
  }
}

const parserFailures: string[] = [];

for (const testCase of matrix.filter(
  (item) => item.expectedBehavior === "convert"
)) {
  const matches = parseCurrencies(testCase.sourceText);
  const expectedCount = testCase.expectedMatchCount ?? 1;
  const currenciesMatch = matches.every(
    (match) => match.currency === testCase.expectedSourceCurrency
  );
  const amountMatches =
    testCase.expectedAmount === undefined ||
    matches.every((match, index) =>
      index > 0 && expectedCount > 1
        ? Number.isFinite(match.amount)
        : Object.is(match.amount, testCase.expectedAmount)
    );

  if (
    matches.length !== expectedCount ||
    !currenciesMatch ||
    !amountMatches
  ) {
    parserFailures.push(
      `${testCase.id}: expected ${expectedCount} ${testCase.expectedSourceCurrency} ${testCase.expectedAmount}, received ${JSON.stringify(matches)}`
    );
  }
}

assert(
  parserFailures.length === 0,
  `Generated convert cases failed production parsing:\n${parserFailures
    .slice(0, 20)
    .join("\n")}`
);

// Canary cases confirm the generator is connected to the real parser, not a
// private smoke-page implementation.
const usdCanary = matrix.find((testCase) => testCase.id === "usd-iso-prefix");
assert(usdCanary, "USD ISO canary is missing");
assert(parseCurrencies(usdCanary.sourceText)[0]?.currency === "USD", "USD canary did not use production parsing");

console.log(
  `Generated ${matrix.length} cases across ${coveredCurrencies.size} currencies and ${formatIds.size} formats.`
);
