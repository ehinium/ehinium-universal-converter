import { fiatCurrencies } from "../data/currencies";

/**
 * What the page tells us about its own currency. Only ambiguous identifiers
 * (`$`, `¥`, `kr`, `R`, `lei`, `ريال`, currency icons, `,–` prices) consult it;
 * unambiguous symbols and ISO codes never change meaning.
 */
export type CurrencyContext = {
  country?: string;
  currency?: string;
  source: "structured-data" | "domain" | "path" | "language";
};

export type PageCurrencySignals = {
  hostname: string;
  pathname: string;
  language?: string | null;
  structuredCurrencies?: readonly string[];
};

const EURO_COUNTRIES = [
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT",
  "NL", "PT", "SK", "SI", "ES", "AD", "MC", "SM", "VA", "ME", "XK",
];

const countryCurrency = new Map<string, string>();
const currencyCountries = new Map<string, Set<string>>();

function link(country: string, currency: string): void {
  if (!countryCurrency.has(country)) countryCurrency.set(country, currency);
  const countries = currencyCountries.get(currency) ?? new Set<string>();
  countries.add(country);
  currencyCountries.set(currency, countries);
}

// Retail sites in Iran price in toman even though the rial is the official unit.
link("IR", "IRT");
for (const country of EURO_COUNTRIES) link(country, "EUR");
for (const [country, currency] of [
  ["US", "USD"], ["PR", "USD"], ["EC", "USD"], ["SV", "USD"], ["GB", "GBP"], ["IM", "GBP"],
  ["JE", "GBP"], ["GG", "GBP"], ["LI", "CHF"], ["GL", "DKK"], ["FO", "DKK"],
] as const) link(country, currency);
for (const currency of fiatCurrencies) {
  for (const locale of currency.localeExamples) {
    const region = /-([A-Z]{2})$/u.exec(locale)?.[1];
    if (region) link(region, currency.code);
  }
}
link("IR", "IRR");

const knownCountries = new Set(countryCurrency.keys());
// ccTLDs that are sold as generic names (.io, .co, .tv, .me ...) say nothing
// about the shop's country.
const GENERIC_COUNTRY_DOMAINS = new Set([
  "io", "co", "tv", "me", "ai", "fm", "gg", "ly", "to", "ws", "cc", "tk", "nu", "la", "ag",
  "sh", "ac", "vc", "gl", "sc", "gd", "ms", "pw", "st", "so", "sx", "vg", "am", "fo", "im", "je",
]);
const TLD_COUNTRY_ALIASES: Readonly<Record<string, string>> = { uk: "GB", el: "GR" };
// Large single-country shops on generic domains whose prices use an ambiguous
// sign ("R 4,465", "$ 1.299.900", "Rs. 999", "¥8925") and whose pages name no
// currency or region. Consulted after structured data, the ccTLD and the path.
const NATIONAL_STOREFRONTS: Readonly<Record<string, string>> = {
  "takealot.com": "ZA", "superbalist.com": "ZA", "bash.com": "ZA",
  "kogan.com": "AU", "hktvmall.com": "HK",
  "exito.com": "CO", "alkosto.com": "CO",
  "fravega.com": "AR", "garbarino.com": "AR", "musimundo.com": "AR",
  "coppel.com": "MX", "elpalaciodehierro.com": "MX",
  "flipkart.com": "IN", "myntra.com": "IN", "nykaa.com": "IN", "ajio.com": "IN", "snapdeal.com": "IN",
  "croma.com": "IN", "tatacliq.com": "IN", "meesho.com": "IN",
  "jd.com": "CN", "tmall.com": "CN", "taobao.com": "CN", "pinduoduo.com": "CN", "suning.com": "CN",
  "yodobashi.com": "JP", "biccamera.com": "JP",
};
// A language spoken in essentially one currency area points at it even without a region.
const LANGUAGE_COUNTRY: Readonly<Record<string, string>> = {
  ja: "JP", ko: "KR", fa: "IR", he: "IL", th: "TH", vi: "VN", tr: "TR", pl: "PL", cs: "CZ",
  ro: "RO", hu: "HU", uk: "UA", el: "GR", da: "DK", sv: "SE", nb: "NO", nn: "NO", no: "NO",
  is: "IS", fi: "FI", id: "ID", bg: "BG", hy: "AM", ka: "GE", az: "AZ", kk: "KZ", mn: "MN",
  km: "KH", lo: "LA", my: "MM", ne: "NP", si: "LK", bn: "BD", sr: "RS", mk: "MK", sq: "AL",
};
const PATH_LANGUAGE_CODES = new Set([
  "en", "fr", "de", "es", "it", "pt", "nl", "ar", "zh", "ja", "ko", "ru", "pl", "tr", "sv",
  "da", "no", "nb", "fi", "cs", "hu", "ro", "el", "he", "th", "vi", "id", "ms", "uk", "fa",
]);
// Path segments that name a language far more often than a market: "/ar/" is
// Arabic (not Argentina), "/vi/" Vietnamese, "/pt/" Portuguese (Brazil uses /pt-br/).
const LANGUAGE_ONLY_SEGMENTS = new Set([
  "en", "ar", "zh", "ja", "ko", "ru", "ms", "he", "fa", "vi", "pt", "hi", "ur", "bn", "ta", "sw", "el", "sr", "ka", "hy",
]);
// Region tokens that name no single country, also inside locale pairs: North
// America ("/na-en/" is not Namibia), Latin America, Europe, Asia-Pacific.
const REGION_SEGMENTS = new Set(["na", "la", "eu", "ap"]);
// Bare segments that are words in paths: "/do/checkout", "/me/orders".
const WORD_SEGMENTS = new Set(["do", "me"]);

function countryOf(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const upper = (TLD_COUNTRY_ALIASES[code.toLowerCase()] ?? code).toUpperCase();
  return knownCountries.has(upper) ? upper : undefined;
}

export function currencyForCountry(country: string): string | undefined {
  return countryCurrency.get(country.toUpperCase());
}

export function countriesForCurrency(currency: string): ReadonlySet<string> {
  return currencyCountries.get(currency) ?? new Set();
}

export function countryFromHostname(hostname: string): string | undefined {
  const labels = hostname.toLowerCase().replace(/\.$/u, "").split(".");
  const tld = labels.at(-1) ?? "";
  if (tld.length !== 2 || GENERIC_COUNTRY_DOMAINS.has(tld)) {
    // "com.co" style second-level domains are national even when the ccTLD is generic.
    return labels.length >= 3 && ["com", "co", "net", "org"].includes(labels.at(-2) ?? "") && tld.length === 2
      ? countryOf(tld)
      : undefined;
  }
  return countryOf(tld);
}

export function countryFromStorefront(hostname: string): string | undefined {
  const labels = hostname.toLowerCase().replace(/\.$/u, "").split(".");
  return NATIONAL_STOREFRONTS[labels.slice(-2).join(".")];
}

function languageParts(language: string | null | undefined): { primary?: string; region?: string } {
  if (!language) return {};
  const [primary, ...rest] = language.toLowerCase().split(/[-_]/u);
  return { primary, region: rest.find((part) => /^[a-z]{2}$/u.test(part)) };
}

function pathCountryOf(code: string): string | undefined {
  return REGION_SEGMENTS.has(code) ? undefined : countryOf(code);
}

/**
 * `/en-ca/`, `/fr_ca/`, `/us/en/`, `/ae/en/`, `/uk/` and brand storefronts like
 * `/falabella-cl/`. A bare segment is also a language or a word ("/sv/" is
 * Swedish more often than El Salvador): the page's own language decides it.
 */
export function countryFromPath(pathname: string, hostname: string, language?: string | null): string | undefined {
  const segments = pathname.toLowerCase().split("/").filter(Boolean).slice(0, 2);
  const brand = hostname.toLowerCase().split(".").filter((label) => label !== "www").at(-2);
  const { primary } = languageParts(language);
  for (const segment of segments) {
    const pair = /^([a-z]{2})[-_]([a-z]{2})$/u.exec(segment);
    if (pair) {
      // Language-country ("en-ca") is the usual order; country-language also occurs.
      return pathCountryOf(pair[2]) ?? (PATH_LANGUAGE_CODES.has(pair[2]) ? pathCountryOf(pair[1]) : undefined);
    }
    if (/^[a-z]{2}$/u.test(segment)) {
      if (LANGUAGE_ONLY_SEGMENTS.has(segment) || REGION_SEGMENTS.has(segment) || WORD_SEGMENTS.has(segment)) continue;
      // The segment is the page's own language: "/ca/" on a Catalan page, "/uk/" on a Ukrainian one.
      if (segment === primary) continue;
      if (segment === "uk") return "GB";
      const country = countryOf(segment);
      if (country) return country;
    }
    const storefront = brand ? new RegExp(`^${brand}-([a-z]{2})$`, "u").exec(segment) : null;
    if (storefront) return countryOf(storefront[1]);
  }
  return undefined;
}

export function countryFromLanguage(language: string | null | undefined): string | undefined {
  const { primary, region } = languageParts(language);
  return countryOf(region) ?? (primary ? countryOf(LANGUAGE_COUNTRY[primary]) : undefined);
}

function dominantCurrency(currencies: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const currency of currencies) {
    const code = currency.toUpperCase();
    if (fiatCurrencies.some((definition) => definition.code === code)) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const ranked = [...counts].sort((left, right) => right[1] - left[1]);
  if (ranked.length === 0) return undefined;
  // Mixed structured data (a marketplace listing several currencies) is not a page currency.
  return ranked.length === 1 || ranked[0][1] >= 3 * ranked[1][1] ? ranked[0][0] : undefined;
}

export function resolveCurrencyContext(signals: PageCurrencySignals): CurrencyContext | null {
  const structured = dominantCurrency(signals.structuredCurrencies ?? []);
  const domainCountry = countryFromHostname(signals.hostname);
  const pathCountry = domainCountry ? undefined : countryFromPath(signals.pathname, signals.hostname, signals.language);
  const storefrontCountry = domainCountry || pathCountry ? undefined : countryFromStorefront(signals.hostname);
  const languageCountry = countryFromLanguage(signals.language);
  const country = domainCountry ?? pathCountry ?? storefrontCountry ?? languageCountry;

  if (structured) {
    const structuredCountry = country && countriesForCurrency(structured).has(country) ? country : undefined;
    return { currency: structured, country: structuredCountry ?? [...countriesForCurrency(structured)][0], source: "structured-data" };
  }
  if (!country) return null;
  return {
    country,
    currency: currencyForCountry(country),
    source: domainCountry || storefrontCountry ? "domain" : pathCountry ? "path" : "language",
  };
}
