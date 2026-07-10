import { parseCurrencies } from "./currencyParser";

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
  "12.99 €",
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
expectCurrencies("12.99€", []);
expectCurrencies("productUSD 12.99", []);
expectCurrencies("USD 12.99model", []);
expectCurrencies("Product eur 80", []);
