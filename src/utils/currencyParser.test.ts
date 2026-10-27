import { parseCurrencies } from "./currencyParser";
import { resolveCurrencyContext } from "./currencyContext";

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

for (const [identifier, currency, amount] of [
  ["IRT", "IRT", 1000],
  ["TMN", "IRT", 1000],
  ["Toman", "IRT", 1000],
  ["Tomans", "IRT", 1000],
  ["تومان", "IRT", 1000],
  ["تومن", "IRT", 1000],
  ["IRR", "IRR", 10000],
  ["Rial", "IRR", 10000],
  ["Rials", "IRR", 10000],
  ["ریال", "IRR", 10000],
] as const) {
  expectSingleCurrencyMatch(`${identifier} ${amount}`, { amount, currency });
  expectSingleCurrencyMatch(`${amount} ${identifier}`, { amount, currency });
}

for (const [identifier, currency] of [
  ["toman", "IRT"],
  ["TOMAN", "IRT"],
  ["tomans", "IRT"],
  ["tmn", "IRT"],
  ["rial", "IRR"],
  ["RIALS", "IRR"],
] as const) {
  expectSingleCurrencyMatch(`${identifier} 1000`, {
    amount: 1000,
    currency,
  });
  expectSingleCurrencyMatch(`1000 ${identifier}`, {
    amount: 1000,
    currency,
  });
}

expectSingleCurrencyMatch("تومان ۱۰۰۰", { amount: 1000, currency: "IRT" });
expectSingleCurrencyMatch("۱۰۰۰ تومان", { amount: 1000, currency: "IRT" });
expectSingleCurrencyMatch("ریال ١٠٠٠٠", { amount: 10000, currency: "IRR" });
expectSingleCurrencyMatch("١٠٠٠٠ ریال", { amount: 10000, currency: "IRR" });

for (const [text, amount, currency] of [
  ["۲۹۹٫۸۰۰٫۰۰۰ تومان", 299800000, "IRT"],
  ["۳۹۲٫۱۴۰٫۰۰۰ تومان", 392140000, "IRT"],
  ["۲۹۹٬۸۰۰٬۰۰۰ تومان", 299800000, "IRT"],
  ["۲۹۹.۸۰۰.۰۰۰ تومان", 299800000, "IRT"],
  ["299,800,000 تومان", 299800000, "IRT"],
  ["299 800 000 تومان", 299800000, "IRT"],
  ["299\u00a0800\u00a0000 تومان", 299800000, "IRT"],
  ["299\u202f800\u202f000 تومان", 299800000, "IRT"],
  ["٢٩٩٫٨٠٠٫٠٠٠ تومان", 299800000, "IRT"],
  ["۲۹۹٫۸۰۰٫۰۰۰ IRT", 299800000, "IRT"],
  ["۲۹۹٫۸۰۰٫۰۰۰ IRR", 299800000, "IRR"],
  ["69,448,000تومان", 69448000, "IRT"],
  ["۶۹,۴۴۸,۰۰۰تومان", 69448000, "IRT"],
  ["٥٤,٣٣٥,٠٠٠تومن", 54335000, "IRT"],
  ["۵۴,۳۳۵,۰۰۰تومن", 54335000, "IRT"],
  ["۱,۰۰۰,۰۰۰ریال", 1000000, "IRR"],
  ["20,000,000IRT", 20000000, "IRT"],
  ["20,000,000TMN", 20000000, "IRT"],
  ["20,000,000Toman", 20000000, "IRT"],
  ["20,000,000Tomans", 20000000, "IRT"],
  ["10,000,000IRR", 10000000, "IRR"],
  ["10,000,000Rial", 10000000, "IRR"],
  ["10,000,000Rials", 10000000, "IRR"],
  ["۱۷,۳۶۲,۰۰۰ تومانی", 17362000, "IRT"],
  ["۲۰۰,۰۰۰ ریالی", 200000, "IRR"],
  ["۶۹,۴۴۸,۰۰۰\u200cتومان", 69448000, "IRT"],
  ["۶۹,۴۴۸,۰۰۰\u200fتومان", 69448000, "IRT"],
] as const) {
  expectSingleCurrencyMatch(text, { amount, currency });
}

expectCurrencyMatches("6,950,000 تومان 7% 7,450,000", [
  { raw: "6,950,000 تومان", amount: 6950000, currency: "IRT" },
]);
expectCurrencyMatches("71,767,000 3%69,448,000تومان", [
  { raw: "69,448,000تومان", amount: 69448000, currency: "IRT" },
]);
expectCurrencyMatches("7,889,000 تومان4,733,400 تومان40%", [
  { raw: "7,889,000 تومان", amount: 7889000, currency: "IRT" },
  { raw: "4,733,400 تومان", amount: 4733400, currency: "IRT" },
]);

for (const percentageFalsePositive of [
  "تومان7%",
  "تومان 7%",
  "7% تومان",
]) {
  expectCurrencies(percentageFalsePositive, []);
}

for (const malformedIranianAmount of [
  "۲۹۹٫۸۰٫۰۰۰ تومان",
  "۲۹۹٫٫۸۰۰ تومان",
  "۲۹۹٬۸۰٬۰۰۰ تومان",
]) {
  expectCurrencies(malformedIranianAmount, []);
}

for (const identifier of ["تومان", "تومن"] as const) {
  for (const decoration of ["ء", "ءء", "ءءء", "ءءءءء"] as const) {
    const decorated = `${identifier}${decoration}`;
    expectSingleCurrencyMatch(`${decorated} ۱۰۰۰`, {
      amount: 1000,
      currency: "IRT",
    });
    expectSingleCurrencyMatch(`۱۰۰۰ ${decorated}`, {
      amount: 1000,
      currency: "IRT",
    });
  }
}

for (const decoration of ["ء", "ءء", "ءءء", "ءءءءء"] as const) {
  const decorated = `ریال${decoration}`;
  expectSingleCurrencyMatch(`${decorated} ۱۰۰۰۰`, {
    amount: 10000,
    currency: "IRR",
  });
  expectSingleCurrencyMatch(`۱۰۰۰۰ ${decorated}`, {
    amount: 10000,
    currency: "IRR",
  });
}

for (const falsePositive of [
  "تومان ء ۱۰۰۰",
  "۱۰۰۰ تومان ء",
  "ATMAN 1000",
  "TOMANIC 1000",
  "XIRT 1000",
  "IRRX 10000",
  "تومانک ۱۰۰۰",
  "پیشتومان ۱۰۰۰",
  "ریالی ۱۰۰۰۰",
  "اریال ۱۰۰۰۰",
  "TMN123",
  "T 1000",
  "ت ۱۰۰۰",
  "توم ۱۰۰۰",
  "ری ۱۰۰۰۰",
  "مسئولء ۱۰۰۰",
  "شیء ۱۰۰۰",
]) {
  expectCurrencies(falsePositive, []);
}

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

// --- Page context and regional formats (multi-site audit) ---
{
  const contextOf = (hostname: string, pathname = "/", language: string | null = null) =>
    resolveCurrencyContext({ hostname, pathname, language });
  const expectWith = (
    context: ReturnType<typeof contextOf>,
    text: string,
    expected: Array<{ amount: number; currency: string }>
  ) => {
    const actual = parseCurrencies(text, context).map(({ amount, currency }) => ({ amount, currency }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${JSON.stringify(text)} with ${JSON.stringify(context)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
  };

  // Bare "$" and "¥" follow the page's own currency; without context they keep the defaults.
  expectWith(contextOf("www.amazon.ca"), "$1,299.99", [{ amount: 1299.99, currency: "CAD" }]);
  expectWith(contextOf("www.amazon.com.mx"), "$6,149", [{ amount: 6149, currency: "MXN" }]);
  expectWith(contextOf("www.falabella.com", "/falabella-cl/search"), "$ 349.990", [{ amount: 349990, currency: "CLP" }]);
  expectWith(contextOf("www.trademe.co.nz"), "$633.80", [{ amount: 633.8, currency: "NZD" }]);
  expectWith(contextOf("24h.pchome.com.tw"), "$14,999", [{ amount: 14999, currency: "TWD" }]);
  expectWith(contextOf("www.tmall.com", "/", "zh-CN"), "¥8925", [{ amount: 8925, currency: "CNY" }]);
  expectWith(contextOf("search.jd.com", "/", "zh-CN"), "￥129.00", [{ amount: 129, currency: "CNY" }]);
  expectWith(contextOf("www.amazon.ca", "/", "fr-ca"), "12,99 $", [{ amount: 12.99, currency: "CAD" }]);
  expectWith(contextOf("www.momoshop.com.tw"), "19,999 元", [{ amount: 19999, currency: "TWD" }]);
  expectCurrencies("$1,299.99", [{ amount: 1299.99, currency: "USD" }]);
  expectCurrencies("¥8925", [{ amount: 8925, currency: "JPY" }]);
  expectCurrencies("￥38,709", [{ amount: 38709, currency: "JPY" }]);

  // Symbols that only name a currency on that currency's pages.
  expectWith(contextOf("www.takealot.com", "/all", "en-ZA"), "R 6,999", [{ amount: 6999, currency: "ZAR" }]);
  // takealot.com itself says only lang="en"; the shop is known to be South African.
  expectWith(contextOf("www.takealot.com", "/all", "en"), "R 6,499 R 6,999", [
    { amount: 6499, currency: "ZAR" }, { amount: 6999, currency: "ZAR" },
  ]);
  expectWith(contextOf("www.example.com", "/", "en"), "R 6,999", []);
  // A lone letter is a model or a unit unless it reads as a price.
  const takealot = contextOf("www.takealot.com", "/all", "en");
  expectWith(takealot, "Canon EOS R5 body", []);
  expectWith(takealot, "Audi R8", []);
  expectWith(takealot, "R2-D2 figure", []);
  expectWith(takealot, "R6 499", [{ amount: 6499, currency: "ZAR" }]);
  expectWith(takealot, "R1,299.00", [{ amount: 1299, currency: "ZAR" }]);
  expectWith(contextOf("shop.example.com", "/", "my"), "Samsung 55 inch 4K Smart TV", []);
  expectWith(contextOf("shop.example.com", "/", "my"), "100K views", []);
  expectWith(contextOf("shop.example.com", "/", "my"), "K 25,000", [{ amount: 25000, currency: "MMK" }]);
  expectWith(contextOf("shop.example.al", "/", "sq"), "Coca-Cola 1.5 L", []);
  expectWith(contextOf("shop.example.al", "/", "sq"), "Frigorifer 250 L", []);
  expectWith(contextOf("shop.example.al", "/", "sq"), "1.200 L", [{ amount: 1200, currency: "ALL" }]);
  expectWith(contextOf("shop.example.gm"), "3D printer", []);
  expectWith(contextOf("www.ikea.com", "/ro/ro/cat"), "699lei", [{ amount: 699, currency: "RON" }]);
  expectWith(contextOf("www.ikea.com", "/cz/cs/cat"), "2 990,–", [{ amount: 2990, currency: "CZK" }]);
  // A currency written after the dash names the price.
  expectWith(contextOf("www.alza.cz"), "29,- €", [{ amount: 29, currency: "EUR" }]);
  expectWith(contextOf("www.alza.cz"), "1.290,- EUR", [{ amount: 1290, currency: "EUR" }]);
  expectWith(contextOf("www.galaxus.ch"), "1 290,- Kč", [{ amount: 1290, currency: "CZK" }]);
  expectWith(contextOf("www.power.no"), "Førpris: 10 990,-.", [{ amount: 10990, currency: "NOK" }]);
  expectWith(contextOf("www.amazon.in"), "Rs. 1,299", [{ amount: 1299, currency: "INR" }]);
  expectWith(contextOf("www.xcite.com", "/ar", "ar-KW"), "12.500 دينار", [{ amount: 12.5, currency: "KWD" }]);
  expectWith(contextOf("www.digikala.com", "/", "fa"), "۱۰۰٬۰۰۰ ريال", [{ amount: 100000, currency: "IRR" }]);
  for (const text of ["R 6,999", "699lei", "2 990,–", "Førpris: 10 990,-.", "12.500 دينار", "12.99 $"]) {
    expectCurrencies(text, []);
  }
  // An explicit currency beats the page currency for ",–" prices.
  expectWith(contextOf("www.example.de"), "CHF 1'299.–", [{ amount: 1299, currency: "CHF" }]);

  // Unspaced CJK currency names.
  expectCurrencies("329,000원~", [{ amount: 329000, currency: "KRW" }]);
  expectCurrencies("28% 61,920원", [{ amount: 61920, currency: "KRW" }]);
  expectCurrencies("8,800円または20,000円割引に", [{ amount: 8800, currency: "JPY" }, { amount: 20000, currency: "JPY" }]);
  expectCurrencies("5,000円〜172,000円割引に", [{ amount: 5000, currency: "JPY" }, { amount: 172000, currency: "JPY" }]);
  expectCurrencies("または5,825円/月", [{ amount: 5825, currency: "JPY" }]);

  // Arabic currency names and signs.
  expectCurrencies("1,430.00 درهم", [{ amount: 1430, currency: "AED" }]);
  expectCurrencies("د.إ.\u200f228.99", [{ amount: 228.99, currency: "AED" }]);
  expectCurrencies("49.28 ريال", [{ amount: 49.28, currency: "SAR" }]);
  expectCurrencies("20,499.00 جنيه", [{ amount: 20499, currency: "EGP" }]);
  expectCurrencies("100 جنيه إسترليني", [{ amount: 100, currency: "GBP" }]);
  expectCurrencies("\u20c1 1899", [{ amount: 1899, currency: "SAR" }]);
  expectCurrencies("Dhs 275", [{ amount: 275, currency: "AED" }]);

  // Three-decimal dinars; Iraqi prices stay whole dinars.
  expectCurrencies("12.900 KD", [{ amount: 12.9, currency: "KWD" }]);
  expectCurrencies("1,239.900 KD", [{ amount: 1239.9, currency: "KWD" }]);
  expectCurrencies("25,000 IQD", [{ amount: 25000, currency: "IQD" }]);

  // Ranges: no negative bounds, shared currency for the bare bound.
  expectCurrencies("AED118.00-AED148.00", [{ amount: 118, currency: "AED" }, { amount: 148, currency: "AED" }]);
  expectCurrencies("Get £25-£855 for your trade-in.", [{ amount: 25, currency: "GBP" }, { amount: 855, currency: "GBP" }]);
  expectCurrencies("1 500 - 2 700 zł", [{ amount: 1500, currency: "PLN" }, { amount: 2700, currency: "PLN" }]);
  expectCurrencies("17.500 - 35.000 TL", [{ amount: 17500, currency: "TRY" }, { amount: 35000, currency: "TRY" }]);
  expectCurrencies("$10 - 20", [{ amount: 10, currency: "USD" }, { amount: 20, currency: "USD" }]);
  expectCurrencies("$5 - 50 pieces", [{ amount: 5, currency: "USD" }]);
  expectCurrencies("9,99 - 19,99 €", [{ amount: 9.99, currency: "EUR" }, { amount: 19.99, currency: "EUR" }]);
  expectCurrencies("Ceny od 1 500 - 2 700 zł", [{ amount: 1500, currency: "PLN" }, { amount: 2700, currency: "PLN" }]);
  // A discount after a price and a number ending a product name bound no range.
  expectCurrencies("$19.99 -20%", [{ amount: 19.99, currency: "USD" }]);
  expectCurrencies("€19,99 −20%", [{ amount: 19.99, currency: "EUR" }]);
  expectCurrencies("Only $19.99 - 50% off", [{ amount: 19.99, currency: "USD" }]);
  expectCurrencies("$19.99 - 20", [{ amount: 19.99, currency: "USD" }]);
  expectCurrencies("iPhone 13 - 450 €", [{ amount: 450, currency: "EUR" }]);
  expectCurrencies("Pack of 3 - 12,99 €", [{ amount: 12.99, currency: "EUR" }]);
  expectCurrencies("Golf 7 - 12.500 €", [{ amount: 12500, currency: "EUR" }]);
  expectCurrencies("Herren Sneaker Gr. 42 - 79,99 €", [{ amount: 79.99, currency: "EUR" }]);

  // Persian magnitude words.
  expectCurrencies("۹۹۰ هزار تومان", [{ amount: 990000, currency: "IRT" }]);
  expectCurrencies("۲ میلیون و ۵۰۰ هزار تومان", [{ amount: 2500000, currency: "IRT" }]);

  // CJK units between digits: the whole number, never the part after the unit.
  expectCurrencies("月額1万5000円です", [{ amount: 15000, currency: "JPY" }]);
  expectCurrencies("1万円以上で送料無料", [{ amount: 10000, currency: "JPY" }]);
  expectCurrencies("1.5万円", [{ amount: 15000, currency: "JPY" }]);
  expectCurrencies("1億2000万円", [{ amount: 120000000, currency: "JPY" }]);
  expectCurrencies("1,234千円", [{ amount: 1234000, currency: "JPY" }]);
  expectCurrencies("5千元", [{ amount: 5000, currency: "CNY" }]);
  expectCurrencies("5만원 이상 무료배송", [{ amount: 50000, currency: "KRW" }]);
  expectCurrencies("1만 5000원", [{ amount: 15000, currency: "KRW" }]);
  expectCurrencies("2억 5천만원", [{ amount: 250000000, currency: "KRW" }]);
  for (const text of ["3万人", "1万15000円", "1億3億円", "2元素", "3원색", "1+1원피스"]) expectCurrencies(text, []);
  expectCurrencies("5000원에 판매", [{ amount: 5000, currency: "KRW" }]);

  // Model names and prose are not prices.
  for (const text of [
    "布張りソファ(MK02 KD)", "بازی FC 26 برای PS5", "100 KM", "USD 007", "Galaxy S24 5G 256GB",
    "The DHS 2025 Budget in Brief", "Form DHS-160", "EUR-2024 standard",
  ]) {
    expectCurrencies(text, []);
  }
  expectCurrencies("Dhs 199", [{ amount: 199, currency: "AED" }]);
  expectCurrencies("DHS 1,299", [{ amount: 1299, currency: "AED" }]);
  expectCurrencies("MK 1,250.00", [{ amount: 1250, currency: "MWK" }]);
  expectCurrencies("two dollars ($2.00) CAD", [{ amount: 2, currency: "USD" }]);

  // Signs: a typographic minus or a minus before the currency sign is negative
  // (IKEA's size difference "−79.01€", a coupon); range and word hyphens are not.
  expectCurrencies("−79.01€", [{ amount: -79.01, currency: "EUR" }]);
  expectCurrencies("Coupon -$5.00", [{ amount: -5, currency: "USD" }]);
  expectCurrencies("Total: −€4,50", [{ amount: -4.5, currency: "EUR" }]);
  expectCurrencies("USB-5€", []);
  expectCurrencies("10−20€", [{ amount: 10, currency: "EUR" }, { amount: 20, currency: "EUR" }]);
  expectCurrencies("$10-$20", [{ amount: 10, currency: "USD" }, { amount: 20, currency: "USD" }]);

  // A sign between two prices belongs to the reading that keeps both prices.
  expectCurrencies("€ 5 € 10", [{ amount: 5, currency: "EUR" }, { amount: 10, currency: "EUR" }]);
  expectCurrencies("10 € 20 €", [{ amount: 10, currency: "EUR" }, { amount: 20, currency: "EUR" }]);
  expectCurrencies("EUR 100 EUR 200", [{ amount: 100, currency: "EUR" }, { amount: 200, currency: "EUR" }]);
}
