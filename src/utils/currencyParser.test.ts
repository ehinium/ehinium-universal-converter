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
  "12.99 $",
  "12.99 €",
  "12.99 £",
  "12.99 ¥",
]) {
  expectCurrencies(falsePositive, []);
}

expectCurrencies("$12.99", [{ amount: 12.99, currency: "USD" }]);
expectCurrencies("AED24.64", [{ amount: 24.64, currency: "AED" }]);
expectCurrencies("304.95 TL", [{ amount: 304.95, currency: "TRY" }]);
expectCurrencies("TL 304.95", [{ amount: 304.95, currency: "TRY" }]);
expectCurrencies("USD 1,299.99", [{ amount: 1299.99, currency: "USD" }]);
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
