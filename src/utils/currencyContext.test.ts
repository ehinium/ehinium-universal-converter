import { resolveCurrencyContext, type CurrencyContext } from "./currencyContext";

function expectContext(
  hostname: string,
  pathname: string,
  language: string | null,
  expected: Pick<CurrencyContext, "country" | "currency" | "source"> | null,
  structuredCurrencies: string[] = []
): void {
  const actual = resolveCurrencyContext({ hostname, pathname, language, structuredCurrencies });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${hostname}${pathname} (${language}): expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

// Country domains, including second-level ones.
expectContext("www.amazon.ca", "/dp/B0CNJXHJHK", "en-ca", { country: "CA", currency: "CAD", source: "domain" });
expectContext("www.amazon.com.mx", "/", "es-mx", { country: "MX", currency: "MXN", source: "domain" });
expectContext("www.trademe.co.nz", "/a/marketplace", "en", { country: "NZ", currency: "NZD", source: "domain" });
expectContext("www.amazon.co.uk", "/", "en-gb", { country: "GB", currency: "GBP", source: "domain" });
expectContext("www.amazon.co.jp", "/s", "en-us", { country: "JP", currency: "JPY", source: "domain" });
expectContext("www.verkkokauppa.fi", "/", "fi", { country: "FI", currency: "EUR", source: "domain" });
// Generic-use ccTLDs say nothing about the shop's market.
expectContext("example.io", "/", null, null);
expectContext("shop.example.co", "/", null, null);

// Market segments in the path of generic domains.
expectContext("www.apple.com", "/ca/shop/buy-iphone", "en-CA", { country: "CA", currency: "CAD", source: "path" });
expectContext("www.ikea.com", "/cz/cs/cat/koberce-10653/", "cs-CZ", { country: "CZ", currency: "CZK", source: "path" });
expectContext("www.ikea.com", "/ae/en/p/kallax", "en-AE", { country: "AE", currency: "AED", source: "path" });
expectContext("www2.hm.com", "/en_us/men/products/jeans.html", "en", { country: "US", currency: "USD", source: "path" });
expectContext("www.nike.com", "/gb/t/air-force-1", "en-GB", { country: "GB", currency: "GBP", source: "path" });
expectContext("www.falabella.com", "/falabella-cl/search", "es", { country: "CL", currency: "CLP", source: "path" });
// "/ar/" is Arabic, not Argentina; the language region decides.
expectContext("www.example.com", "/ar/products", "ar-SA", { country: "SA", currency: "SAR", source: "language" });
// Region tokens and words in a path name no country: "/na-en/" is North America, not Namibia.
expectContext("shop.example.com", "/na-en/item", "en-US", { country: "US", currency: "USD", source: "language" });
expectContext("shop.example.com", "/en-na/item", "en-US", { country: "US", currency: "USD", source: "language" });
expectContext("shop.example.com", "/la/item", "es", null);
expectContext("shop.example.com", "/do/checkout", "en", null);
expectContext("shop.example.com", "/me/orders", "en", null);
// A segment that is the page's own language: "/sv/" on a Swedish page is Sweden, not El Salvador.
expectContext("shop.example.com", "/sv/", "sv", { country: "SE", currency: "SEK", source: "language" });
expectContext("shop.example.com", "/ca/", "ca", null);
expectContext("shop.example.com", "/uk/", "uk", { country: "UA", currency: "UAH", source: "language" });
expectContext("shop.example.com", "/uk/", "en", { country: "GB", currency: "GBP", source: "path" });

// Page language, with or without a region.
expectContext("www.taobao-example.com", "/", "zh-CN", { country: "CN", currency: "CNY", source: "language" });
expectContext("www.digikala.com", "/search/", "fa", { country: "IR", currency: "IRT", source: "language" });
expectContext("www.example.com", "/", "en", null);

// National shops on generic domains whose pages name no currency ("R 4,465").
expectContext("www.takealot.com", "/all", "en", { country: "ZA", currency: "ZAR", source: "domain" });
expectContext("www.tmall.com", "/", "zh-CN", { country: "CN", currency: "CNY", source: "domain" });
// A market in the path still decides: kogan.com/nz/ is New Zealand.
expectContext("www.kogan.com", "/nz/buy/tv", "en", { country: "NZ", currency: "NZD", source: "path" });

// Structured data (JSON-LD priceCurrency) is the strongest signal.
expectContext("www.example.com", "/p/1", "en", { currency: "SGD", country: "SG", source: "structured-data" }, ["SGD", "SGD"]);
expectContext("www.example.ca", "/p/1", "en", { currency: "USD", country: "US", source: "structured-data" }, ["USD"]);
// A marketplace listing several currencies has no single page currency.
expectContext("www.example.com", "/", null, null, ["USD", "EUR"]);

console.log("Currency context tests passed.");
