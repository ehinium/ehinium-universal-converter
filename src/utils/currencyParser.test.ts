import { parseCurrencies } from "./currencyParser";

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

function expectCurrencies(
  text: string,
  expected: Array<{ amount: number; currency: string }>
): void {
  const actual = parseCurrencies(text).map(({ amount, currency }) => ({
    amount,
    currency,
  }));

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${JSON.stringify(text)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function expectCurrencyMatches(
  text: string,
  expected: Array<{ raw: string; amount: number; currency: string }>
): void {
  const actual = parseCurrencies(text).map(({ raw, amount, currency }) => ({
    raw,
    amount,
    currency,
  }));

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${JSON.stringify(text)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function expectSingleCurrencyMatch(
  text: string,
  expected: { raw?: string; amount: number; currency: string }
): void {
  expectCurrencyMatches(text, [
    {
      raw: expected.raw ?? text,
      amount: expected.amount,
      currency: expected.currency,
    },
  ]);
}

for (const falsePositive of [
  "BN59-01312G",
  "Q70",
  "Q80",
  "O50",
  "6 series",
  "7 series",
  "8 series",
  "100 %",
  "Product 5%",
  "iPhone 15",
  "12.99 $",
  "12.99 £",
  "12.99 ¥",
]) {
  expectCurrencies(falsePositive, []);
}

expectCurrencies("$12.99", [{ amount: 12.99, currency: "USD" }]);
expectCurrencies("€12.99", [{ amount: 12.99, currency: "EUR" }]);
expectCurrencies("£12.99", [{ amount: 12.99, currency: "GBP" }]);
expectCurrencies("¥12.99", [{ amount: 12.99, currency: "JPY" }]);
expectCurrencies("AED24.64", [{ amount: 24.64, currency: "AED" }]);
expectCurrencies("304.95 TL", [{ amount: 304.95, currency: "TRY" }]);
expectCurrencies("TL 304.95", [{ amount: 304.95, currency: "TRY" }]);
expectCurrencies("USD 1,299.99", [{ amount: 1299.99, currency: "USD" }]);
expectCurrencies("80 eur", [{ amount: 80, currency: "EUR" }]);
expectCurrencies("80 Eur", [{ amount: 80, currency: "EUR" }]);
expectCurrencies("eur 80", [{ amount: 80, currency: "EUR" }]);
expectCurrencies("usd 100", [{ amount: 100, currency: "USD" }]);
expectCurrencies("100 aed", [{ amount: 100, currency: "AED" }]);
expectCurrencies("10000000IRR", [{ amount: 10000000, currency: "IRR" }]);
for (const text of [".99 USD", "USD .99", "$.99", ".99USD"]) {
  expectSingleCurrencyMatch(text, { amount: 0.99, currency: "USD" });
}
expectSingleCurrencyMatch("-.99 USD", { amount: -0.99, currency: "USD" });
expectSingleCurrencyMatch("+.99 USD", { amount: 0.99, currency: "USD" });
expectCurrencies("1..99 USD", []);
expectCurrencies("1,2.99 USD", []);

expectSingleCurrencyMatch("(1,234.56 USD)", {
  raw: "(1,234.56 USD)",
  amount: -1234.56,
  currency: "USD",
});
expectSingleCurrencyMatch("(USD 1,234.56)", {
  raw: "(USD 1,234.56)",
  amount: -1234.56,
  currency: "USD",
});

for (const [text, amount] of [
  ["1,23,456 INR", 123456],
  ["12,34,567 INR", 1234567],
  ["1,23,45,678 INR", 12345678],
  ["12,34,567.89 INR", 1234567.89],
] as const) {
  expectSingleCurrencyMatch(text, { amount, currency: "INR" });
}
for (const malformed of [
  "1,2,345 INR",
  "123,45,678 INR",
  "1,234,56 INR",
  "1,23,4567 INR",
]) {
  expectCurrencies(malformed, []);
}

expectSingleCurrencyMatch("1,234.56 CLP$", {
  raw: "1,234.56 CLP$",
  amount: 1234.56,
  currency: "CLP",
});

for (const text of [
  "4.99€",
  "4.99€/month",
  "4.99€ / month",
  "4.99€ per month",
  "4.99€ each / month",
]) {
  expectSingleCurrencyMatch(text, { raw: "4.99€", amount: 4.99, currency: "EUR" });
}

for (const text of [
  "TRY 99/month",
  "TRY 99 / month",
  "TRY 99 per month",
  "$19.99/mo",
  "19.99 USD/month",
  "13.99€ / month after trial",
  "TRY 55 per month after",
  "TRY 135 / month",
  "TRY 165 / month",
]) {
  const expectedCurrency =
    text.includes("€") ? "EUR" : text.includes("$") || text.includes("USD") ? "USD" : "TRY";
  const amount = Number(text.match(/\d+(?:\.\d+)?/u)?.[0]);
  expectCurrencies(text, [{ amount, currency: expectedCurrency }]);
}

expectCurrencyMatches(
  "3.99€ / month with ads or 4.99€ / month without ads",
  [
    { raw: "3.99€", amount: 3.99, currency: "EUR" },
    { raw: "4.99€", amount: 4.99, currency: "EUR" },
  ]
);

{
  const input = "Before 4.99€ / month after trial";
  const match = parseCurrencies(input)[0];
  expectEqual(match?.raw, "4.99€", "recurring price raw range");
  expectEqual(match?.start, input.indexOf("4.99€"), "recurring price start");
  expectEqual(match?.end, input.indexOf("4.99€") + "4.99€".length, "recurring price end");
  expectEqual(match?.tokenType, "symbol", "recurring price token type");
}

for (const text of [
  "4.99/month",
  "version 4.99/5",
  "12/05/2026",
  "v2.99/build",
  "score 4.99/10",
]) {
  expectEqual(parseCurrencies(text).length, 0, `non-currency slash expression ${text}`);
}
expectSingleCurrencyMatch("1,234.56 MOP$", {
  raw: "1,234.56 MOP$",
  amount: 1234.56,
  currency: "MOP",
});
expectSingleCurrencyMatch("(1,234.56 CLP$)", {
  raw: "(1,234.56 CLP$)",
  amount: -1234.56,
  currency: "CLP",
});
expectCurrencyMatches("1,234.56 CLP$ and 1,234.56 CLP$", [
  { raw: "1,234.56 CLP$", amount: 1234.56, currency: "CLP" },
  { raw: "1,234.56 CLP$", amount: 1234.56, currency: "CLP" },
]);
for (const [text, amount, currency] of [
  ["1 234 USD", 1234, "USD"],
  ["1 234 567 USD", 1234567, "USD"],
  ["1\u00a0234 USD", 1234, "USD"],
  ["1\u202f234 USD", 1234, "USD"],
  ["1\u2009234 USD", 1234, "USD"],
  ["1,234.56 USD", 1234.56, "USD"],
  ["1.234,56 EUR", 1234.56, "EUR"],
  ["1234,56 EUR", 1234.56, "EUR"],
  ["1234.56 USD", 1234.56, "USD"],
  ["1,234 USD", 1234, "USD"],
  ["1.234 EUR", 1234, "EUR"],
  ["1'234 CHF", 1234, "CHF"],
  ["1’234 CHF", 1234, "CHF"],
  ["1'234'567.89 CHF", 1234567.89, "CHF"],
  ["USD 1 234", 1234, "USD"],
  ["$1 234", 1234, "USD"],
  ["1 234 USD", 1234, "USD"],
  ["1 234 ֏", 1234, "AMD"],
] as const) {
  expectSingleCurrencyMatch(text, { amount, currency });
}

// Ambiguous single comma/period cases preserve the current heuristic:
// a final separator followed by three digits is grouping for currencies that
// do not use three decimal digits.
expectSingleCurrencyMatch("1,234 USD", { amount: 1234, currency: "USD" });
expectSingleCurrencyMatch("1.234 EUR", { amount: 1234, currency: "EUR" });

// A final comma/period followed by one or two digits is decimal.
expectSingleCurrencyMatch("12,50 EUR", { amount: 12.5, currency: "EUR" });
expectSingleCurrencyMatch("12.50 USD", { amount: 12.5, currency: "USD" });

expectCurrencies("224 900 AMD", [{ amount: 224900, currency: "AMD" }]);
expectCurrencies("224\u00a0900 AMD", [{ amount: 224900, currency: "AMD" }]);
expectCurrencies("224\u202f900 AMD", [{ amount: 224900, currency: "AMD" }]);
expectCurrencies("224\u2009900 AMD", [{ amount: 224900, currency: "AMD" }]);
expectCurrencies("224,900 AMD", [{ amount: 224900, currency: "AMD" }]);
expectCurrencies("224.900 AMD", [{ amount: 224900, currency: "AMD" }]);
expectCurrencies("224'900 AMD", [{ amount: 224900, currency: "AMD" }]);
expectCurrencies("1 224 900 AMD", [{ amount: 1224900, currency: "AMD" }]);
expectCurrencies("1 224 900 ֏", [{ amount: 1224900, currency: "AMD" }]);
expectCurrencies("869 900 ֏", [{ amount: 869900, currency: "AMD" }]);
expectCurrencies("$1 250 000", [{ amount: 1250000, currency: "USD" }]);
expectCurrencies("1 250 000 EUR", [{ amount: 1250000, currency: "EUR" }]);
expectCurrencies("1,234.56 USD", [{ amount: 1234.56, currency: "USD" }]);
expectCurrencies("1.234,56 EUR", [{ amount: 1234.56, currency: "EUR" }]);
expectCurrencies("1 234,56 EUR", [{ amount: 1234.56, currency: "EUR" }]);
expectCurrencies("1\u00a0234,56 EUR", [{ amount: 1234.56, currency: "EUR" }]);
expectCurrencies("12.50 USD", [{ amount: 12.5, currency: "USD" }]);
expectCurrencies("12,50 EUR", [{ amount: 12.5, currency: "EUR" }]);
expectCurrencies("1'234'567 CHF", [{ amount: 1234567, currency: "CHF" }]);
expectCurrencies("1’234’567 CHF", [{ amount: 1234567, currency: "CHF" }]);
expectCurrencyMatches("224 900 AMD", [
  { raw: "224 900 AMD", amount: 224900, currency: "AMD" },
]);
expectCurrencyMatches("869 900 ֏", [
  { raw: "869 900 ֏", amount: 869900, currency: "AMD" },
]);
expectCurrencies("24,500,000 AMD", [{ amount: 24500000, currency: "AMD" }]);
expectCurrencies("AMD 24,500,000", [{ amount: 24500000, currency: "AMD" }]);
expectCurrencies("24,500,000 ֏", [{ amount: 24500000, currency: "AMD" }]);
expectCurrencies("֏ 24,500,000", [{ amount: 24500000, currency: "AMD" }]);
expectCurrencies("19.99 ₾", [{ amount: 19.99, currency: "GEL" }]);
expectCurrencies("1,200 ₺", [{ amount: 1200, currency: "TRY" }]);
expectCurrencies("500 ₴", [{ amount: 500, currency: "UAH" }]);
expectCurrencies("12.99€", [{ amount: 12.99, currency: "EUR" }]);
expectCurrencies("productUSD 12.99", []);
expectCurrencies("USD 12.99model", []);
expectCurrencies("Product eur 80", []);
