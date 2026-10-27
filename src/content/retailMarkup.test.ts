import { Window } from "happy-dom";
import type { CurrencyMatch } from "../utils/currencyParser";
import { setActiveCurrencyContext } from "../utils/currencyParser";
import { resolveCurrencyContext } from "../utils/currencyContext";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";
import { createBadge, getBadgeVisibleText } from "./badgeManager";
import { escapeClippedBadge } from "./badgePlacement";
import { resetGlyphRemaps } from "./glyphCurrencyRemap";

// Markup below is trimmed from real pages captured during the multi-site audit.

const window = new Window();

Object.assign(globalThis, {
  window,
  document: window.document,
  DOMRect: window.DOMRect,
  localStorage: window.localStorage,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  getComputedStyle: window.getComputedStyle.bind(window),
});

const visibleRect = {
  x: 0, y: 0, top: 0, right: 100, bottom: 20, left: 0,
  width: 100, height: 20, toJSON: () => ({}),
};

Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => visibleRect,
});

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function createRoot(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function render(root: HTMLElement, mode: "currencies" | "units" = "currencies", targetCurrency = "USD"): number {
  return renderConversions(getTextNodes(root), {
    enabled: true,
    targetCurrency,
    converterMode: mode,
    badgeStyle: "default",
    badgeVisibility: "always",
    unitSystem: "metric",
    targetLengthUnit: "auto",
    targetWeightUnit: "auto",
    targetTemperatureUnit: "auto",
    scanRoots: [root],
    // Badge text shows the source amount, so tests can see what was parsed.
    convertAmount: (match: CurrencyMatch) => match.amount,
  });
}

function badgeTexts(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>(BADGE_SELECTOR)].map((badge) => getBadgeVisibleText(badge));
}

/** "amount|source|target" of each currency badge: what was parsed, independent of formatting. */
function badgeKeys(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>(BADGE_SELECTOR)].map((badge) => badge.getAttribute("data-ehinium-key") ?? "");
}

// IKEA US: "$" "109" "." "99" split across spans (aria-hidden) plus a screen-reader copy.
{
  const root = createRoot(`
    <span class="pipcom-price"><span aria-hidden="true" class="notranslate"><span class="pipcom-price__nowrap"><span class="pipcom-price__currency">$</span><span class="pipcom-price__integer">109</span></span><span class="pipcom-price__decimal"><span class="pipcom-price__separator">.</span>99</span></span><span class="pipcom-price__sr-text">Price $ 109.99</span></span>
  `);
  expectEqual(render(root, "currencies", "EUR"), 1, "IKEA split price renders once");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["109.99|USD|EUR"]), "IKEA split price keeps its cents");
  expectEqual(root.querySelector(".pipcom-price__sr-text")?.querySelector(BADGE_SELECTOR) ?? null, null, "no badge in the screen-reader copy");
}

// IKEA Germany: "249" "." "00" "€" with the currency after the cents.
{
  const root = createRoot(`
    <span class="pipcom-price"><span aria-hidden="true"><span class="pipcom-price__nowrap"><span class="pipcom-price__integer">249</span></span><span class="pipcom-price__decimal"><span class="pipcom-price__separator">.</span>00</span><span class="pipcom-price__currency">€</span></span><span class="pipcom-price__sr-text">Vorher 249.00€</span></span>
  `);
  expectEqual(render(root), 1, "IKEA euro price renders once");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["249|EUR|USD"]), "IKEA euro price is not read as 00€");
}

// IKEA US rug names: visible text marked aria-hidden is converted as units.
{
  const root = createRoot(`
    <h3><a aria-label="LOHALS, Rug, flatwoven, natural, 5 ' 3 &quot;x7 ' 7 &quot;" href="#">LOHALS</a>
    <span><span aria-hidden="true">Rug, flatwoven, natural, 5 ' 3 "x7 ' 7 "</span></span></h3>
  `);
  expectEqual(render(root, "units"), 1, "aria-hidden rug size converts");
  expectEqual(JSON.stringify(badgeTexts(root)), JSON.stringify(["160.02 × 231.14 cm"]), "rug size badge");
}

// Amazon US: the a-price group with "$" resolves (it used to drop the cents).
{
  setActiveCurrencyContext(resolveCurrencyContext({ hostname: "www.amazon.com", pathname: "/dp/B0CM35P7NC", language: "en-us" }));
  const root = createRoot(`
    <span class="aok-offscreen"> $17.90 </span><span class="a-price" data-a-size="xl"><span class="a-offscreen"> </span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">17<span class="a-price-decimal">.</span></span><span class="a-price-fraction">90</span></span></span>
  `);
  expectEqual(render(root, "currencies", "EUR"), 1, "Amazon US price renders once");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["17.9|USD|EUR"]), "Amazon US price keeps its cents");
  setActiveCurrencyContext(null);
}

// Digikala: toman is an icon element after the number.
{
  const root = createRoot(`
    <div class="flex items-center justify-end gap-1"><span data-testid="price-final">۳۹۵,۱۰۰</span><dds-icon class="flex" name="value-toman" size="4xs"></dds-icon></div>
    <div data-testid="price-no-discount" class="line-through">۴۳۹,۰۰۰</div>
  `);
  expectEqual(render(root), 1, "Digikala price with a toman icon converts");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["395100|IRT|USD"]), "Digikala amount and currency");
  const icon = root.querySelector("dds-icon");
  expectEqual(icon?.nextElementSibling?.matches(BADGE_SELECTOR), true, "badge follows the toman icon");
}

// Sheypoor: toman is an inline SVG.
{
  const root = createRoot(`
    <div class="flex items-center"><span class="text-heading-4-bolder">۱۰۰,۰۰۰,۰۰۰</span><span class="flex size-6" data-test-id="icon-toman"><svg viewBox="0 0 24 24" name="toman"><path d="M0 0"></path></svg></span></div>
  `);
  expectEqual(render(root), 1, "Sheypoor price with an SVG toman converts");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["100000000|IRT|USD"]), "Sheypoor amount and currency");
}

// eMalls: an empty element drawn as toman by CSS; the page currency names it.
{
  setActiveCurrencyContext(resolveCurrencyContext({ hostname: "emalls.ir", pathname: "/", language: "fa" }));
  const root = createRoot(`
    <div class="price-box"><div class="prd-price"><span>۲۹۹,۰۰۰,۰۰۰</span> <small class="unit"></small></div></div>
  `);
  expectEqual(render(root), 1, "eMalls price with a CSS currency icon converts");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["299000000|IRT|USD"]), "eMalls amount and currency");
  setActiveCurrencyContext(null);
}

// Words that only contain "toman" or "rial" ("bottomAnchor", "customAnimation",
// "free-trial", "serial") name no currency.
{
  const root = createRoot(`
    <div class="stats"><span>1,250</span><i class="Stats_bottomAnchor__x1"></i></div>
    <div class="anim"><span class="customAnimation"></span><span>42</span></div>
    <div class="trial"><span data-testid="free-trial-icon"></span><span>14</span></div>
    <div class="serial"><input name="serial_number"><span>12345</span></div>
  `);
  expectEqual(render(root), 0, "names that merely contain toman or rial");
}

// A sign that CSS draws in an empty currency element names its own currency:
// "€" on an English-language page is euro, not the page's dollar.
{
  setActiveCurrencyContext(resolveCurrencyContext({ hostname: "shop.example.com", pathname: "/", language: "en-US" }));
  const original = window.getComputedStyle.bind(window) as unknown as (element: Element, pseudo?: string | null) => CSSStyleDeclaration;
  const patched = (element: Element, pseudo?: string | null) =>
    pseudo === "::before" && element.classList.contains("price-currency")
      ? { content: '"€"' } as unknown as CSSStyleDeclaration
      : original(element, pseudo);
  Object.defineProperty(window, "getComputedStyle", { configurable: true, value: patched });
  const root = createRoot(`<div class="product-price"><span class="price-currency"></span><span>19.99</span></div>`);
  render(root);
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["19.99|EUR|USD"]), "drawn euro sign");
  Object.defineProperty(window, "getComputedStyle", { configurable: true, value: original });
  setActiveCurrencyContext(null);
}

// extra.com: the Saudi riyal sign is an icon; the hidden label holds "SAR".
{
  const root = createRoot(`
    <section class="price"><div><span class="c_global-currency-sign"><span class="global-currency-text">SAR</span></span> <span class="price"><strong>1399</strong></span> <span class="vat">Incl. VAT</span></div>
    <div class="saving-strike"><span class="striked-off">1599</span> <strong class="orange-text">Save <strong><span class="c_global-currency-sign"><span class="global-currency-text">SAR</span></span> 200</strong></strong></div></section>
  `);
  render(root);
  expectEqual(JSON.stringify(badgeKeys(root).sort()), JSON.stringify(["1399|SAR|USD", "200|SAR|USD"]), "extra.com prices take the hidden SAR label");
}

// extra.com draws the riyal sign with its own font on the "€" code point and
// labels it "SAR"; "Cash Back € 350" in that font is riyal, € in another font is euro.
{
  const original = window.getComputedStyle.bind(window);
  const patched = (element: Element, pseudo?: string | null) => {
    const style = original(element as never);
    if (pseudo === "::before" && element.classList.contains("c_global-currency-sign")) {
      return { content: '"€"', fontFamily: '"Dubai"' } as unknown as CSSStyleDeclaration;
    }
    if (pseudo) return { content: "none", fontFamily: "" } as unknown as CSSStyleDeclaration;
    const fontFamily = element.closest(".widget") ? "Arial, sans-serif" : "Dubai, sans-serif";
    return new Proxy(style, { get: (target, key) => key === "fontFamily" ? fontFamily : Reflect.get(target, key) });
  };
  Object.defineProperty(window, "getComputedStyle", { configurable: true, value: patched });
  resetGlyphRemaps();
  const root = createRoot(`
    <section class="price"><div><span class="c_global-currency-sign"><span class="global-currency-text" style="display:none">SAR</span></span> <span class="price"><strong>1399</strong></span></div></section>
    <section class="tag"><span class="text">Cash Back € 350</span></section>
    <div class="widget"><span>Trip € 90</span></div>
  `);
  render(root);
  expectEqual(JSON.stringify(badgeKeys(root).sort()), JSON.stringify(["1399|SAR|USD", "350|SAR|USD", "90|EUR|USD"]), "riyal drawn on the euro glyph");
  Object.defineProperty(window, "getComputedStyle", { configurable: true, value: original });
  resetGlyphRemaps();
}

// Amazon DE delivery line: a "Details" link beside the price in the same element.
{
  const root = createRoot(`
    <div class="a-spacing-base"><span data-csa-c-type="element"> Lieferung für 14,99 € <span class="a-text-bold">10. - 26. November</span>. <a href="#details">Details</a></span></div>
  `);
  expectEqual(render(root), 1, "delivery price beside a link renders");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["14.99|EUR|USD"]), "delivery price amount");
  const badge = root.querySelector(BADGE_SELECTOR);
  expectEqual(badge?.previousSibling?.textContent, " Lieferung für 14,99 € ", "badge follows the price text");
}

// Raised cents without a decimal point: Best Buy's `$399⁹⁹` and a Walmart-style
// span lifted by vertical-align. A plain number after a price is not cents.
{
  const root = createRoot(`
    <section class="bestbuy"><div><span>$399</span><sup>99</sup></div></section>
    <section class="walmart"><div><span>$</span><span>1,299</span><span style="vertical-align: 0.65em">49</span></div></section>
    <section class="reviews"><p>Now $25 <span>12</span> reviews</p></section>
  `);
  render(root, "currencies", "EUR");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".bestbuy")!)), JSON.stringify(["399.99|USD|EUR"]), "superscript cents");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".walmart")!)), JSON.stringify(["1299.49|USD|EUR"]), "raised cents span");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".reviews")!)), JSON.stringify(["25|USD|EUR"]), "a following count is not cents");
}

// A measurement the text already gives in the reader's system gets no badge
// (Flipkart's "138 cm (55 inch)"); one given twice in the other system does.
{
  const root = createRoot(`
    <p class="stated">TCL 138 cm (55 inch) Ultra HD TV</p>
    <p class="imperial">Height: 6 ft (72 in)</p>
    <p class="weight">Weight: 1 lb (16 oz)</p>
  `);
  render(root, "units");
  expectEqual(badgeKeys(root.querySelector(".stated")!).length, 0, "measurement already stated in centimetres");
  expectEqual(badgeKeys(root.querySelector(".imperial")!).length, 2, "feet with inches still converts");
  expectEqual(badgeKeys(root.querySelector(".weight")!).length, 2, "pounds with ounces still converts");
}

// Class names that only contain a screen-reader word are visible content: an
// open cart drawer, Tailwind text shown from the md breakpoint.
{
  const root = createRoot(`
    <section class="cart"><div class="offscreen-cart open"><p>Subtotal $45.00</p></div></section>
    <section class="tailwind"><p class="sr-only md:not-sr-only">Only $29</p></section>
    <section class="hidden-copy"><span class="a-offscreen">$12.00</span></section>
  `);
  render(root, "currencies", "EUR");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".cart")!)), JSON.stringify(["45|USD|EUR"]), "price in an open off-screen cart");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".tailwind")!)), JSON.stringify(["29|USD|EUR"]), "price shown from a breakpoint");
  expectEqual(badgeKeys(root.querySelector(".hidden-copy")!).length, 0, "screen-reader copy stays unconverted");
}

// A full stop or comma after a price is punctuation, not the start of its cents.
{
  const root = createRoot(`
    <section class="sentence"><p>It costs <b>$10</b>.</p></section>
    <section class="list"><p><b>$10</b>, <b>$20</b></p></section>
    <section class="split"><p><span>$399</span><span>.</span><span>99</span></p></section>
  `);
  render(root, "currencies", "EUR");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".sentence")!)), JSON.stringify(["10|USD|EUR"]), "price before a full stop");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".list")!)), JSON.stringify(["10|USD|EUR", "20|USD|EUR"]), "prices separated by a comma");
  expectEqual(JSON.stringify(badgeKeys(root.querySelector(".split")!)), JSON.stringify(["399.99|USD|EUR"]), "cents after a lone point still join");
}

// A currency label next to an unrelated number is not a price.
{
  const root = createRoot(`<nav><span class="currency-switcher">USD</span> <span class="cart-count">3</span></nav>`);
  expectEqual(render(root), 0, "currency switcher next to a counter");
}

// power.no: the visible price has no currency; a screen-reader label says NOK.
{
  const root = createRoot(`
    <div class="price-content"><data class="main-price" value="5799.00" aria-label="5 799,-"><pwr-price><span>5799</span></pwr-price><span class="container-decimal"><pwr-price></pwr-price></span><span class="currency-code"> NOK</span></data></div>
  `);
  expectEqual(render(root), 1, "power.no price takes its hidden currency code");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["5799|NOK|USD"]), "power.no amount and currency");
}

// Verkkokauppa: the visible number has no currency; the screen-reader copy states it.
{
  const root = createRoot(`
    <span class="stm-price__root"><span class="sr_true">Hinta nyt 2499,00 €, normaalihinta 3499,00 €.</span><span><data class="stm-price__currentData" value="2499">2 499<small>,00</small></data><small> <s><data class="stm-price__previousData" value="3499">3 499<small>,00</small></data></s></small></span></span>
    <span class="stm-price__root"><span class="sr_true">Hinta 399,99 €.</span><span><data class="stm-price__currentData" value="399.99">399<small>,99</small></data></span></span>
  `);
  render(root);
  expectEqual(JSON.stringify(badgeKeys(root).sort()), JSON.stringify(["2499|EUR|USD", "3499|EUR|USD", "399.99|EUR|USD"]), "Verkkokauppa prices mirror their screen-reader copy");
}

// A screen-reader copy only lends its currency to the same amount.
{
  const root = createRoot(`<span><span class="sr-only">Price 10,00 €</span><data>12,00</data></span>`);
  expectEqual(render(root), 0, "different amount next to a screen-reader price");
}

// Free and zero prices need no badge.
{
  const root = createRoot(`<p>Pay $0.00 today</p>`);
  expectEqual(render(root, "currencies", "EUR"), 0, "zero amount");
}

// Several prices in one text keep their order.
{
  const root = createRoot(`<p>From $40 to $50</p>`);
  render(root, "currencies", "EUR");
  expectEqual(JSON.stringify(badgeKeys(root)), JSON.stringify(["40|USD|EUR", "50|USD|EUR"]), "range badges in source order");
}

// A badge clipped by a small fixed-height box moves after the box.
{
  const root = createRoot(`<li><span class="button" style="overflow:hidden"><span class="label">52" x 52" (Square)</span></span></li>`);
  const button = root.querySelector<HTMLElement>(".button")!;
  const label = root.querySelector<HTMLElement>(".label")!;
  const badge = document.createElement("span");
  label.append(badge);
  Object.defineProperty(button, "getBoundingClientRect", { configurable: true, value: () => ({ ...visibleRect, height: 20, bottom: 20 }) });
  // Below the button's label while inside it; on the list item's line once after it.
  Object.defineProperty(badge, "getBoundingClientRect", {
    configurable: true,
    value: () => badge.parentElement === label ? { ...visibleRect, top: 22, bottom: 38, height: 16 } : visibleRect,
  });
  expectEqual(escapeClippedBadge(badge).escapedAfter, button, "clipping box is escaped");
  expectEqual(button.nextElementSibling, badge, "badge now follows the box");
  const visibleBadge = document.createElement("span");
  label.append(visibleBadge);
  expectEqual(JSON.stringify(escapeClippedBadge(visibleBadge)), JSON.stringify({ escapedAfter: null, clipped: false }), "a fully visible badge stays inline");
}

// Amazon US colour swatch: the tile that cuts the badge off is ten levels up and
// has no room; the badge is reported clipped so the conversion goes to hover.
{
  const root = createRoot(`<ul><li><span class="tile" style="overflow:hidden;display:inline-block"><span class="inner"><span><div><div><div><div><div><div><span class="price"><span>$17.90</span></span></div></div></div></div></div></div></span></span></span></li></ul>`);
  const tile = root.querySelector<HTMLElement>(".tile")!;
  const price = root.querySelector<HTMLElement>(".price span")!;
  const badge = document.createElement("span");
  price.append(badge);
  Object.defineProperty(tile, "getBoundingClientRect", { configurable: true, value: () => ({ ...visibleRect, height: 20, bottom: 20 }) });
  Object.defineProperty(badge, "getBoundingClientRect", { configurable: true, value: () => ({ ...visibleRect, top: 22, bottom: 41, height: 19 }) });
  const placement = escapeClippedBadge(badge, price);
  expectEqual(placement.clipped && placement.escapedAfter === null, true, "deep fixed-size tile reports a clipped badge");
  expectEqual(placement.clippedBy, tile, "the tile takes the hover conversion (overlays cover the price)");
  expectEqual(badge.parentElement, price, "the badge is not moved out of the tile");
}

// A link scrolled out of a clipped row (Jumia's related searches) keeps its
// badge hidden with it instead of showing the badge under the row.
{
  const root = createRoot(`<div class="row" style="overflow:hidden"><a class="link">55 inch oled tv</a></div>`);
  const row = root.querySelector<HTMLElement>(".row")!;
  const link = root.querySelector<HTMLElement>(".link")!;
  const badge = document.createElement("span");
  link.append(badge);
  Object.defineProperty(row, "getBoundingClientRect", { configurable: true, value: () => ({ ...visibleRect, right: 100, width: 100 }) });
  Object.defineProperty(link, "getBoundingClientRect", { configurable: true, value: () => ({ ...visibleRect, left: 120, right: 220, x: 120 }) });
  Object.defineProperty(badge, "getBoundingClientRect", { configurable: true, value: () => ({ ...visibleRect, left: 222, right: 270, x: 222, width: 48 }) });
  expectEqual(JSON.stringify(escapeClippedBadge(badge, link)), JSON.stringify({ escapedAfter: null, clipped: false }), "badge of a clipped-out source stays in place");
  expectEqual(badge.parentElement, link, "badge still inside its link");
}

// A badge that pushes a fixed-height button's own label out of view moves after
// the button; a box that overflows anyway (a clamped title) keeps it.
{
  const root = createRoot(`
    <div><span class="button" style="overflow:hidden;display:inline-block"><span class="label">2' x 6' (Runner)</span></span></div>
    <div><span class="title" style="overflow:hidden;display:block">A very long product title that is clamped</span></div>
  `);
  const sizeBox = (element: HTMLElement, badge: HTMLElement, overflowsAnyway: boolean) => {
    Object.defineProperty(element, "clientHeight", { configurable: true, get: () => 20 });
    Object.defineProperty(element, "clientWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(element, "scrollWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      get: () => overflowsAnyway || badge.style.display !== "none" ? 40 : 20,
    });
  };
  const button = root.querySelector<HTMLElement>(".button")!;
  const buttonBadge = document.createElement("span");
  root.querySelector(".label")!.append(buttonBadge);
  sizeBox(button, buttonBadge, false);
  expectEqual(escapeClippedBadge(buttonBadge).escapedAfter, button, "badge that overflows the button moves after it");
  expectEqual(button.nextElementSibling, buttonBadge, "badge follows the button");
  const title = root.querySelector<HTMLElement>(".title")!;
  const titleBadge = document.createElement("span");
  title.append(titleBadge);
  sizeBox(title, titleBadge, true);
  expectEqual(escapeClippedBadge(titleBadge).escapedAfter, null, "badge in an already clamped title stays");
}

const rect = (top: number, bottom: number, left = 0, right = 100) => ({
  ...visibleRect, x: left, y: top, top, bottom, left, right, width: right - left, height: bottom - top,
});
const unchanged = JSON.stringify({ escapedAfter: null, clipped: false });

// Amazon India colour swatch: the tile's bottom edge trims a pixel of the
// badge's padding. The value stays readable, so the badge stays in the tile.
{
  const root = createRoot(`<ul><li><span class="tile" style="overflow:hidden;display:inline-block"><span class="price">₹7,999.00</span></span></li></ul>`);
  const tile = root.querySelector<HTMLElement>(".tile")!;
  const price = root.querySelector<HTMLElement>(".price")!;
  const badge = createBadge("$84.22", "7,999.00 INR → $84.22");
  price.after(badge);
  Object.defineProperty(tile, "getBoundingClientRect", { configurable: true, value: () => rect(0, 113) });
  Object.defineProperty(price, "getBoundingClientRect", { configurable: true, value: () => rect(77, 93, 4, 57) });
  const prototypeRect = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "getBoundingClientRect")!;
  // The host and the badge inside its shadow root share one box: 94.2 to 114.6.
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      return this === badge || this.hasAttribute("data-euc-shadow-badge") ? rect(94.2, 114.6, 4, 49) : visibleRect;
    },
  });
  expectEqual(JSON.stringify(escapeClippedBadge(badge, price)), unchanged, "badge with trimmed padding stays");
  // The list price below it is then pushed out of the tile: its badge stays hidden with it.
  const listPrice = document.createElement("span");
  listPrice.textContent = "₹20,000.00";
  badge.after(listPrice);
  const listBadge = createBadge("$210.57", "20,000.00 INR → $210.57");
  listPrice.after(listBadge);
  Object.defineProperty(listPrice, "getBoundingClientRect", { configurable: true, value: () => rect(114.6, 130.6, 4, 54) });
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      return this === listBadge || this.hasAttribute("data-euc-shadow-badge") ? rect(130.6, 150, 4, 54) : visibleRect;
    },
  });
  expectEqual(JSON.stringify(escapeClippedBadge(listBadge, listPrice)), unchanged, "badge of a price pushed out of the tile stays hidden with it");
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", prototypeRect);
}

// A carousel that cuts its own last line a few pixels short cuts the badge
// beside the price the same way; the badge stays.
{
  const root = createRoot(`<div class="carousel" style="overflow:hidden"><span class="price">$9,199.00</span></div>`);
  const carousel = root.querySelector<HTMLElement>(".carousel")!;
  const price = root.querySelector<HTMLElement>(".price")!;
  const badge = document.createElement("span");
  price.after(badge);
  Object.defineProperty(carousel, "getBoundingClientRect", { configurable: true, value: () => rect(0, 100, 0, 1300) });
  Object.defineProperty(price, "getBoundingClientRect", { configurable: true, value: () => rect(90, 104, 640, 743) });
  Object.defineProperty(badge, "getBoundingClientRect", { configurable: true, value: () => rect(89, 104.4, 749, 793) });
  expectEqual(JSON.stringify(escapeClippedBadge(badge, price)), unchanged, "badge clipped like its price stays");
}

// Amazon India offer card: a badge on the last line of a clamped offer makes
// the line two pixels taller; that is no overflow, and the badge stays.
{
  const root = createRoot(`<div><span class="offer" style="overflow:hidden;display:block;line-height:18.2px">Upto ₹1,000.00 discount on select Credit Cards</span></div>`);
  const offer = root.querySelector<HTMLElement>(".offer")!;
  const badge = document.createElement("span");
  offer.append(badge);
  Object.defineProperty(offer, "clientHeight", { configurable: true, get: () => 55 });
  Object.defineProperty(offer, "clientWidth", { configurable: true, get: () => 134 });
  Object.defineProperty(offer, "scrollWidth", { configurable: true, get: () => 134 });
  Object.defineProperty(offer, "scrollHeight", { configurable: true, get: () => badge.style.display === "none" ? 56 : 57 });
  expectEqual(JSON.stringify(escapeClippedBadge(badge)), unchanged, "a slightly taller last line keeps the badge inline");
}

// A badge on the hidden fourth line of a clamped offer cannot move below it:
// the card's text area has a fixed height and the badge would cover the
// "1 offer" link. The conversion goes to hover on the offer text instead.
{
  const root = createRoot(`<div class="content" style="height:59px"><span class="offer" style="overflow:hidden;display:block">Upto <b class="price">₹239.00</b> cashback as Amazon Pay Balance when…</span></div><a href="#offers">1 offer</a>`);
  const content = root.querySelector<HTMLElement>(".content")!;
  const offer = root.querySelector<HTMLElement>(".offer")!;
  const price = root.querySelector<HTMLElement>(".price")!;
  const badge = document.createElement("span");
  offer.append(badge);
  Object.defineProperty(content, "getBoundingClientRect", { configurable: true, value: () => rect(0, 59, 0, 134) });
  Object.defineProperty(offer, "getBoundingClientRect", { configurable: true, value: () => rect(0, 55, 0, 134) });
  Object.defineProperty(price, "getBoundingClientRect", { configurable: true, value: () => rect(1, 17, 34, 86) });
  Object.defineProperty(badge, "getBoundingClientRect", {
    configurable: true,
    value: () => badge.parentElement === offer ? rect(56, 75, 6, 50) : rect(55, 74, 6, 50),
  });
  const placement = escapeClippedBadge(badge, price);
  expectEqual(placement.clipped && placement.escapedAfter === null, true, "badge that would spill out of the card is clipped");
  expectEqual(placement.clippedBy, offer, "the offer text takes the hover conversion");
  expectEqual(badge.parentElement, offer, "the badge is put back where it was");
}

// Amazon Japan search: a size early in a three-line clamped title. Its badge
// lands after the hidden lines, below the product card's edge too. Leaving the
// clamp (as wide as the title, not as the matched "55\"") is enough: the badge
// shows just below the title, inside the card.
{
  const root = createRoot(`<div class="card" style="overflow:hidden"><div><div><div><div class="holder"><a class="clamp" style="overflow:hidden;display:block"><span class="title">Smart TV <b class="size">55"</b> 4K HDR with a very long product name</span></a></div></div></div></div></div>`);
  const card = root.querySelector<HTMLElement>(".card")!;
  const holder = root.querySelector<HTMLElement>(".holder")!;
  const clamp = root.querySelector<HTMLElement>(".clamp")!;
  const title = root.querySelector<HTMLElement>(".title")!;
  const size = root.querySelector<HTMLElement>(".size")!;
  const badge = document.createElement("span");
  title.append(badge);
  Object.defineProperty(card, "getBoundingClientRect", { configurable: true, value: () => rect(0, 100, 0, 256) });
  Object.defineProperty(holder, "getBoundingClientRect", { configurable: true, value: () => rect(0, 100, 0, 256) });
  Object.defineProperty(clamp, "getBoundingClientRect", { configurable: true, value: () => rect(0, 72, 0, 256) });
  Object.defineProperty(title, "getBoundingClientRect", { configurable: true, value: () => rect(0, 72, 0, 256) });
  Object.defineProperty(size, "getBoundingClientRect", { configurable: true, value: () => rect(0, 17, 50, 74) });
  Object.defineProperty(badge, "getBoundingClientRect", {
    configurable: true,
    value: () => badge.parentElement === title ? rect(110, 129, 100, 150) : rect(74, 93, 0, 50),
  });
  expectEqual(escapeClippedBadge(badge, size, title).escapedAfter, clamp, "badge leaves the clamped title, not the card");
  expectEqual(clamp.nextElementSibling, badge, "badge sits right below the title");
}

// extra.com's size picker is a carousel row: badges that make its slides wider
// push later slides further along the row, which is meant to scroll. The
// badges stay; only content pushed below a box counts there.
{
  const root = createRoot(`<div class="swiper" style="overflow:hidden;display:block"><div class="slide"><span class="size">65 Inch</span></div></div>`);
  const swiper = root.querySelector<HTMLElement>(".swiper")!;
  const size = root.querySelector<HTMLElement>(".size")!;
  const badge = document.createElement("span");
  size.after(badge);
  Object.defineProperty(swiper, "getBoundingClientRect", { configurable: true, value: () => rect(620, 660, 888, 1374) });
  Object.defineProperty(size, "getBoundingClientRect", { configurable: true, value: () => rect(629, 648, 1077, 1122) });
  Object.defineProperty(badge, "getBoundingClientRect", { configurable: true, value: () => rect(628, 648, 1128, 1182) });
  Object.defineProperty(swiper, "clientWidth", { configurable: true, get: () => 486 });
  Object.defineProperty(swiper, "clientHeight", { configurable: true, get: () => 40 });
  Object.defineProperty(swiper, "scrollHeight", { configurable: true, get: () => 40 });
  Object.defineProperty(swiper, "scrollWidth", { configurable: true, get: () => badge.style.display === "none" ? 486 : 640 });
  expectEqual(JSON.stringify(escapeClippedBadge(badge, size)), unchanged, "badges that widen a carousel row stay");
}

// A badge cut off by a box far larger than its price (a carousel row) takes
// its hover on the price, not on the whole row.
{
  const root = createRoot(`<ul class="row" style="overflow:hidden"><li><span class="price">$20.00</span></li></ul>`);
  const row = root.querySelector<HTMLElement>(".row")!;
  const price = root.querySelector<HTMLElement>(".price")!;
  const badge = document.createElement("span");
  price.after(badge);
  Object.defineProperty(row, "getBoundingClientRect", { configurable: true, value: () => rect(0, 100, 0, 1300) });
  Object.defineProperty(price, "getBoundingClientRect", { configurable: true, value: () => rect(80, 96, 10, 50) });
  Object.defineProperty(badge, "getBoundingClientRect", { configurable: true, value: () => rect(98, 117, 10, 54) });
  const placement = escapeClippedBadge(badge, price);
  expectEqual(placement.clipped, true, "badge under the row is clipped");
  expectEqual(placement.clippedBy, undefined, "no hover target as large as the row");
}

console.log("Retail markup regressions passed.");
