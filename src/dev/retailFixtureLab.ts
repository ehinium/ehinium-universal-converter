import "./retailFixtureLab.css";
import { getBadgeVisibleText } from "../content/badgeManager";
import { renderCurrencyConversionsOnly } from "../content/conversionScan";
import { getTextNodes } from "../content/domScanner";
import { resetRenderedConversions } from "../content/domRenderer";
import { parseCurrencies } from "../utils/currencyParser";
import { defaultSettings } from "../utils/defaultSettings";
import type { ExchangeRates } from "../types/rates";

const app = document.querySelector<HTMLElement>("#app") ?? failMissingRoot();

function failMissingRoot(): never {
  throw new Error("Missing #app");
}

type Fixture = {
  id: string;
  market: string;
  locale: string;
  pattern: string;
  expectedCurrency: string;
  expectedMatches: number;
  expectedBadges: number;
  html: string;
  mutation?: (root: HTMLElement, step: number) => string;
};

type FixtureResult = {
  id: string;
  market: string;
  locale: string;
  pattern: string;
  textNodes: number;
  parserMatches: number;
  parsed: ReturnType<typeof parseCurrencies>;
  renderedBadges: number;
  badgeTexts: string[];
  pass: boolean;
  reasons: string[];
  mutationStep: number;
  capturedAt: string;
};

const fixtures: Fixture[] = [
  {
    id: "amazon-split-usd",
    market: "Amazon US",
    locale: "en-US",
    pattern: "split whole/fraction + hidden accessible price",
    expectedCurrency: "USD",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Noise-cancelling headphones</div><button class="market-button" type="button"><span class="a-price"><span class="a-offscreen">$129.99</span><span aria-hidden="true" class="split-price"><span class="symbol">$</span><span class="whole">129</span><span class="fraction">99</span></span></span></button></article>`,
  },
  {
    id: "ebay-range-usd",
    market: "eBay US",
    locale: "en-US",
    pattern: "range inside linked product card",
    expectedCurrency: "USD",
    expectedMatches: 2,
    expectedBadges: 2,
    html: `<article class="product-card"><a class="market-button" href="#fixture"><div class="product-image"></div><div class="product-title">Refurbished camera body</div><div class="price-row"><span class="price">US $349.00 to US $429.00</span></div></a><div>Free shipping</div></article>`,
  },
  {
    id: "walmart-current-old",
    market: "Walmart US",
    locale: "en-US",
    pattern: "current + struck previous price",
    expectedCurrency: "USD",
    expectedMatches: 2,
    expectedBadges: 2,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Cordless stick vacuum</div><div class="price-row"><span class="price">$78.00</span><span class="old-price">$99.00</span></div><div class="discount">Save $21.00</div></article>`,
  },
  {
    id: "trendyol-try",
    market: "Trendyol Turkey",
    locale: "tr-TR",
    pattern: "European separator + suffix symbol",
    expectedCurrency: "TRY",
    expectedMatches: 2,
    expectedBadges: 2,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Kablosuz kulaklık</div><div class="price-row"><span class="price">1.249,90 TL</span><span class="old-price">1.599,90 TL</span></div></article>`,
  },
  {
    id: "digikala-irr-rtl",
    market: "Digikala Iran",
    locale: "fa-IR",
    pattern: "RTL + Persian digits + rial label",
    expectedCurrency: "IRR",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card rtl" lang="fa" dir="rtl"><div class="product-image"></div><div class="product-title">گوشی موبایل مدل تست</div><div class="price-row"><span class="price">۱۲٬۴۹۰٬۰۰۰ ریال</span><span class="discount">۱۵٪</span></div></article>`,
  },
  {
    id: "noon-aed-rtl",
    market: "Noon UAE",
    locale: "ar-AE",
    pattern: "Arabic context + ISO prefix",
    expectedCurrency: "AED",
    expectedMatches: 2,
    expectedBadges: 2,
    html: `<article class="product-card rtl" lang="ar" dir="rtl"><div class="product-image"></div><div class="product-title">ساعة ذكية</div><div class="price-row"><span class="price">AED 249.00</span><span class="old-price">AED 329.00</span></div></article>`,
  },
  {
    id: "rakuten-jpy",
    market: "Rakuten Japan",
    locale: "ja-JP",
    pattern: "yen prefix + tax note",
    expectedCurrency: "JPY",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card" lang="ja"><div class="product-image"></div><div class="product-title">ワイヤレススピーカー</div><div class="price-row"><span class="price">JPY 12,800</span><small>税込</small></div></article>`,
  },
  {
    id: "coupang-krw",
    market: "Coupang Korea",
    locale: "ko-KR",
    pattern: "KRW integer + member shipping copy",
    expectedCurrency: "KRW",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card" lang="ko"><div class="product-image"></div><div class="product-title">로켓배송 테스트 상품</div><div class="price-row"><span class="price">KRW 39,900</span></div><div>무료배송</div></article>`,
  },
  {
    id: "flipkart-inr",
    market: "Flipkart India",
    locale: "en-IN",
    pattern: "Indian grouping + current/old price",
    expectedCurrency: "INR",
    expectedMatches: 2,
    expectedBadges: 2,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Laptop, 16 GB RAM</div><div class="price-row"><span class="price">INR 1,24,990</span><span class="old-price">INR 1,49,990</span></div></article>`,
  },
  {
    id: "shopee-idr",
    market: "Shopee Indonesia",
    locale: "id-ID",
    pattern: "compact prefix + dot grouping",
    expectedCurrency: "IDR",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Mechanical keyboard</div><div class="price-row"><span class="price">IDR 749.000</span></div></article>`,
  },
  {
    id: "mercado-brl",
    market: "Mercado Livre Brazil",
    locale: "pt-BR",
    pattern: "Brazilian separators + installment copy",
    expectedCurrency: "BRL",
    expectedMatches: 2,
    expectedBadges: 2,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Smart TV 55 polegadas</div><div class="price-row"><span class="price">BRL 2.799,00</span></div><div>10x de BRL 279,90 sem juros</div></article>`,
  },
  {
    id: "dynamic-variant",
    market: "Dynamic SPA",
    locale: "en-US",
    pattern: "variant replacement + repeated rescans",
    expectedCurrency: "USD",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Configurable phone</div><div class="price-row" data-price-host><span class="price">USD 699.00</span></div><div class="variant-list"><button type="button">128 GB</button><button type="button">256 GB</button></div></article>`,
    mutation(root, step) {
      const prices = ["USD 699.00", "USD 749.00", "USD 829.00"];
      const host = root.querySelector<HTMLElement>("[data-price-host]");
      if (host) host.innerHTML = `<span class="price">${prices[step % prices.length]}</span>`;
      return `Replaced price subtree with ${prices[step % prices.length]}`;
    },
  },
  {
    id: "lazy-card",
    market: "Infinite-scroll marketplace",
    locale: "en-GB",
    pattern: "lazy product insertion",
    expectedCurrency: "GBP",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card"><div class="product-image"></div><div class="product-title">Scroll sentinel</div><div data-lazy-host>No product loaded yet</div></article>`,
    mutation(root, step) {
      const host = root.querySelector<HTMLElement>("[data-lazy-host]");
      if (host) host.innerHTML = step % 2 ? `<div class="price-row"><span class="price">GBP 84.50</span></div>` : "No product loaded yet";
      return step % 2 ? "Inserted lazy product price" : "Removed lazy product price";
    },
  },
  {
    id: "dark-overlay-card",
    market: "Dark commerce UI",
    locale: "en-CA",
    pattern: "dark surface + clickable price",
    expectedCurrency: "CAD",
    expectedMatches: 1,
    expectedBadges: 1,
    html: `<article class="product-card market-dark"><div class="product-title">Gaming monitor</div><button class="market-button" type="button"><span class="price">CAD 549.99</span></button></article>`,
  },
];

const rates: ExchangeRates = Object.fromEntries([
  "USD","TRY","IRR","AED","JPY","KRW","INR","IDR","BRL","GBP","CAD","EUR"
].map((code, index) => [code, index === 11 ? 1 : Math.max(1, index + 1)]));
const results = new Map<string, FixtureResult>();
const mutationSteps = new Map<string, number>();

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderShell(): void {
  app.innerHTML = `<div class="lab"><header class="lab-header"><div><div class="eyebrow">Ehinium engineering</div><h1>Retail DOM fixture smoke lab</h1><p>Development-only reconstructed storefront fixtures exercise production parser, scanner, renderer and duplicate guards without depending on live sites.</p></div><span class="dev-chip">Development only</span></header><section class="toolbar"><label>Search<input id="search" type="search" placeholder="Market, locale, pattern..."></label><label>Target<select id="target"><option>EUR</option><option>USD</option><option>GBP</option></select></label><button id="run-all">Run all</button><button id="mutate-all" class="secondary">Mutate dynamic fixtures</button><button id="export" class="secondary">Export diagnostics JSON</button><button id="copy" class="secondary">Copy failure summary</button><button id="reset" class="secondary">Reset</button></section><section id="summary" class="summary"></section><section id="grid" class="fixture-grid"></section></div>`;
  document.querySelector("#search")?.addEventListener("input", renderGrid);
  document.querySelector("#run-all")?.addEventListener("click", runAll);
  document.querySelector("#mutate-all")?.addEventListener("click", mutateAll);
  document.querySelector("#export")?.addEventListener("click", exportReport);
  document.querySelector("#copy")?.addEventListener("click", copyFailures);
  document.querySelector("#reset")?.addEventListener("click", resetAll);
  document.querySelector("#target")?.addEventListener("change", runAll);
  renderGrid();
}

function renderGrid(): void {
  const query = (document.querySelector<HTMLInputElement>("#search")?.value ?? "").toLowerCase();
  const visible = fixtures.filter((f) => `${f.market} ${f.locale} ${f.pattern}`.toLowerCase().includes(query));
  const grid = document.querySelector<HTMLElement>("#grid");
  if (!grid) return;
  grid.innerHTML = visible.map((fixture) => {
    const result = results.get(fixture.id);
    const state = result ? (result.pass ? "pass" : "fail") : "pending";
    const label = result ? (result.pass ? "Pass" : "Fail") : "Not run";
    return `<article class="fixture" data-fixture-id="${fixture.id}"><header class="fixture-head"><div><h2>${escapeHtml(fixture.market)}</h2><p>${escapeHtml(fixture.locale)} · ${escapeHtml(fixture.pattern)}</p></div><span class="fixture-state ${state}">${label}</span></header><div class="fixture-stage" data-stage>${fixture.html}</div><div class="fixture-actions"><button data-action="run">Run fixture</button>${fixture.mutation ? '<button data-action="mutate">Mutate DOM</button>' : ""}<button data-action="inspect">Log DOM snapshot</button></div><pre class="fixture-log">${result ? escapeHtml(JSON.stringify(result, null, 2)) : "No diagnostics captured."}</pre></article>`;
  }).join("");
  grid.onclick = handleGridClick;
  renderSummary();
}

function collectParsed(root: HTMLElement) {
  return getTextNodes(root).flatMap((node) => parseCurrencies(node.textContent ?? ""));
}

function runFixture(id: string): FixtureResult | null {
  const fixture = fixtures.find((item) => item.id === id);
  const card = document.querySelector<HTMLElement>(`[data-fixture-id="${id}"]`);
  const stage = card?.querySelector<HTMLElement>("[data-stage]");
  if (!fixture || !stage) return null;
  resetRenderedConversions(stage);
  const nodes = getTextNodes(stage);
  const parsed = collectParsed(stage);
  const targetCurrency = (document.querySelector<HTMLSelectElement>("#target")?.value ?? "EUR");
  const settings = { ...defaultSettings, targetCurrency };
  renderCurrencyConversionsOnly(nodes, settings, rates, [stage]);
  const badges = [...stage.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"], [data-euc-badge="true"]')];
  const badgeTexts = badges.map((badge) => getBadgeVisibleText(badge));
  const relevant = parsed.filter((match) => match.currency === fixture.expectedCurrency);
  const reasons: string[] = [];
  if (relevant.length !== fixture.expectedMatches) reasons.push(`Expected ${fixture.expectedMatches} ${fixture.expectedCurrency} parser matches, got ${relevant.length}.`);
  if (badges.length !== fixture.expectedBadges) reasons.push(`Expected ${fixture.expectedBadges} badges, got ${badges.length}.`);
  if (new Set(badgeTexts).size !== badgeTexts.length && badgeTexts.length > 1) reasons.push("Duplicate visible badge text detected.");
  const result: FixtureResult = { id, market: fixture.market, locale: fixture.locale, pattern: fixture.pattern, textNodes: nodes.length, parserMatches: relevant.length, parsed, renderedBadges: badges.length, badgeTexts, pass: reasons.length === 0, reasons, mutationStep: mutationSteps.get(id) ?? 0, capturedAt: new Date().toISOString() };
  results.set(id, result);
  return result;
}

function runAll(): void { fixtures.forEach((fixture) => runFixture(fixture.id)); renderGrid(); }

function mutateFixture(id: string): void {
  const fixture = fixtures.find((item) => item.id === id);
  const stage = document.querySelector<HTMLElement>(`[data-fixture-id="${id}"] [data-stage]`);
  if (!fixture?.mutation || !stage) return;
  const step = (mutationSteps.get(id) ?? 0) + 1;
  mutationSteps.set(id, step);
  fixture.mutation(stage, step);
  runFixture(id);
  renderGrid();
}

function mutateAll(): void { fixtures.filter((fixture) => fixture.mutation).forEach((fixture) => mutateFixture(fixture.id)); }

function handleGridClick(event: MouseEvent): void {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-action]");
  const card = button?.closest<HTMLElement>("[data-fixture-id]");
  if (!button || !card) return;
  const id = card.dataset.fixtureId ?? "";
  if (button.dataset.action === "run") { runFixture(id); renderGrid(); }
  if (button.dataset.action === "mutate") mutateFixture(id);
  if (button.dataset.action === "inspect") {
    const stage = card.querySelector<HTMLElement>("[data-stage]");
    console.group(`[EUC retail fixture] ${id}`);
    console.log("HTML", stage?.innerHTML);
    console.log("Result", results.get(id));
    console.groupEnd();
  }
}

function renderSummary(): void {
  const summary = document.querySelector<HTMLElement>("#summary");
  if (!summary) return;
  const values = [...results.values()];
  const pass = values.filter((result) => result.pass).length;
  const fail = values.filter((result) => !result.pass).length;
  const badges = values.reduce((sum, result) => sum + result.renderedBadges, 0);
  summary.innerHTML = [[fixtures.length,"Fixtures"],[values.length,"Run"],[pass,"Passed"],[fail,"Failed"],[badges,"Badges"]].map(([value,label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function buildReport() {
  return { schema: "ehinium-retail-fixture-report/v1", generatedAt: new Date().toISOString(), environment: { userAgent: navigator.userAgent, url: location.href, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio }, targetCurrency: document.querySelector<HTMLSelectElement>("#target")?.value ?? "EUR", fixtureDefinitions: fixtures.map(({ html, mutation, ...fixture }) => ({ ...fixture, hasMutation: Boolean(mutation), sourceHtml: html })), summary: { total: fixtures.length, run: results.size, passed: [...results.values()].filter((r) => r.pass).length, failed: [...results.values()].filter((r) => !r.pass).length }, results: [...results.values()] };
}

function exportReport(): void {
  const blob = new Blob([JSON.stringify(buildReport(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `euc-retail-fixtures-${new Date().toISOString().replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function copyFailures(): Promise<void> {
  const failed = [...results.values()].filter((result) => !result.pass);
  const text = failed.length ? failed.map((result) => `${result.id}: ${result.reasons.join(" ")}`).join("\n") : "No failing retail fixtures in the current run.";
  await navigator.clipboard.writeText(text);
}

function resetAll(): void {
  results.clear(); mutationSteps.clear();
  fixtures.forEach((fixture) => {
    const stage = document.querySelector<HTMLElement>(`[data-fixture-id="${fixture.id}"] [data-stage]`);
    if (stage) stage.innerHTML = fixture.html;
  });
  renderGrid();
}

renderShell();
