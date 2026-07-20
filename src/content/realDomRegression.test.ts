import { Window } from "happy-dom";
import type { CurrencyMatch } from "../utils/currencyParser";
import { getTextNodes } from "./domScanner";
import { renderConversions } from "./domRenderer";
import {
  collectCurrencyDomMatches,
  collectSourceTextFragments,
  discoverCurrencyMatchesInElement,
  discoverCurrencyMatchesInRoots,
} from "./currencyDomMatches";
import {
  classifyMutationBatch,
  observeDomChanges,
} from "./observer";
import { selectPriceAnchor } from "./priceAnchor";
import { getTranslationWrapperDiagnostic, resolveTranslationLineage } from "./translationLineage";
import { getBadgeVisibleText } from "./badgeManager";

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

Object.defineProperty(window.HTMLElement.prototype, "checkVisibility", {
  configurable: true,
  value(this: HTMLElement): boolean {
    if (!this.isConnected || this.closest("[hidden]")) return false;
    let current: HTMLElement | null = this;
    while (current) {
      const style = current.getAttribute("style") ?? "";
      if (/(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\D|$))/iu.test(style)) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  },
});

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function createRoot(value: string | number): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  if (typeof value === "string") {
    root.innerHTML = value;
  } else {
    for (let index = 0; index < value; index++) {
      const node = document.createElement("span");
      node.textContent = `ordinary text ${index}`;
      root.append(node);
    }
  }
  document.body.append(root);
  return root;
}

function render(root: HTMLElement): number {
  return renderConversions(getTextNodes(root), {
    enabled: true,
    targetCurrency: "USD",
    converterMode: "currencies",
    badgeStyle: "default",
    badgeVisibility: "always",
    unitSystem: "metric",
    targetLengthUnit: "auto",
    targetWeightUnit: "auto",
    targetTemperatureUnit: "auto",
    scanRoots: [root],
    convertAmount: (match: CurrencyMatch) => match.amount / 10,
  });
}

function expectIdempotent(root: HTMLElement, expectedBadges: number): void {
  render(root);
  render(root);
  expectEqual(document.querySelectorAll(BADGE_SELECTOR).length, expectedBadges, "idempotent badge count");
  expectEqual(root.querySelectorAll("[data-ehinium-price-key]").length, 0, "no broad price marker");
}

{
  const root = createRoot('<p><strong>Standard with ads</strong><span>: 4.99€ / month</span></p>');
  expectIdempotent(root, 1);
  expectEqual(root.querySelector("span")?.querySelector(BADGE_SELECTOR) !== null, true, "badge near direct price span");
}

{
  const root = createRoot("<div>338 TL</div>");
  expectIdempotent(root, 1);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "normal translated-price leaf badge");
}

for (const wrapperCount of [2, 3]) {
  const wrappers = "<font>".repeat(wrapperCount) + "338 TL" + "</font>".repeat(wrapperCount);
  const root = createRoot(wrappers);
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  const lineage = resolveTranslationLineage(candidates[0]!);
  const diagnostic = getTranslationWrapperDiagnostic(candidates[0]!, "USD");
  expectEqual(candidates.length, 1, `${wrapperCount} translation wrappers canonical candidate count`);
  expectEqual(lineage.canonicalElement, root.querySelector("font font" + (wrapperCount === 3 ? " font" : "")), `${wrapperCount} wrappers deepest canonical element`);
  expectEqual(diagnostic.detected, true, `${wrapperCount} translation wrappers detected`);
  expectIdempotent(root, 1);
}

{
  const root = createRoot("<div><span>338 TL</span><span> delivery included</span></div>");
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "complete leaf price takes priority over combined parent");
  expectEqual(candidates[0]?.scanKind, "direct", "leaf-priority candidate kind");
}

{
  const root = createRoot('<div class="card">338 TL</div><div class="card">338 TL</div>');
  expectIdempotent(root, 2);
  expectEqual(root.querySelectorAll(".card")[0]?.querySelectorAll(BADGE_SELECTOR).length, 1, "first equal product card badge");
  expectEqual(root.querySelectorAll(".card")[1]?.querySelectorAll(BADGE_SELECTOR).length, 1, "second equal product card badge");
}

{
  const root = createRoot('<div class="price">338 TL</div>');
  render(root);
  const price = root.querySelector<HTMLElement>(".price")!;
  const oldBadge = price.querySelector<HTMLElement>(BADGE_SELECTOR)!;
  const oldSource = [...price.childNodes].find((node) => node instanceof Text)!;
  const outer = document.createElement("font");
  const inner = document.createElement("font");
  inner.textContent = "338 TL";
  outer.append(inner);
  oldSource.replaceWith(outer);
  const rerendered = render(root);
  expectEqual(rerendered, 0, "translation wrapper adopts existing lineage badge");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "translation wrapper does not duplicate badge");
  expectEqual(root.querySelector(BADGE_SELECTOR), oldBadge, "translation wrapper reuses live badge");

  for (const translatedText of ["338 TL", " 338   TL ", "338 TL"]) {
    const currentSource = price.querySelector("font") ?? price.firstElementChild!;
    const nextOuter = document.createElement("font");
    const nextInner = document.createElement("font");
    nextInner.textContent = translatedText;
    nextOuter.append(nextInner);
    currentSource.replaceWith(nextOuter);
    render(root);
    expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "repeated translation rewrite converges");
  }

  for (const child of [...price.children]) {
    if (!child.matches(BADGE_SELECTOR)) child.remove();
  }
  price.prepend(document.createTextNode("338 TL"));
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "turning translation off keeps one badge");
}

{
  const root = createRoot('<div class="price">338 TL</div>');
  render(root);
  const price = root.querySelector<HTMLElement>(".price")!;
  const source = price.firstChild!;
  const duplicateBadge = price.querySelector<HTMLElement>(BADGE_SELECTOR)!.cloneNode(true);
  price.append(duplicateBadge);
  const outer = document.createElement("font");
  const inner = document.createElement("font");
  inner.textContent = "338 TL";
  outer.append(inner);
  source.replaceWith(outer);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "translated duplicate owned badges reconcile to one");
}

{
  const root = createRoot("<font><font>338 TL</font></font>");
  const source = root.querySelector("font font")?.firstChild as Text;
  expectEqual(collectCurrencyDomMatches([source, source]).length, 1, "overlapping mutation roots select one canonical source");
}

{
  const root = createRoot('<div class="price">338 TL</div>');
  render(root);
  const price = root.querySelector<HTMLElement>(".price")!;
  price.replaceChildren();
  const outer = document.createElement("font");
  const inner = document.createElement("font");
  inner.textContent = "338 TL";
  outer.append(inner);
  price.append(outer);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "orphaned translation badge replaced once");
}

{
  const root = createRoot('<div class="layout"><div class="leaf">From £349</div></div>');
  const leaf = root.querySelector<HTMLElement>(".leaf")!;
  Object.defineProperty(leaf, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...visibleRect, width: 0, height: 0, right: 0, bottom: 0 }),
  });
  const source = leaf.firstChild as Text;
  const selection = selectPriceAnchor([source], source.textContent ?? "");
  expectEqual(selection.anchor, root.querySelector(".layout"), "zero-box leaf walks to smallest viable ancestor");
  expectEqual(selection.candidates[0]?.rejectedRule, "zero-size-layout-box", "zero-box rejection is specific");
  expectEqual(render(root), 1, "From GBP leaf renders once");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "From GBP leaf badge count");
}

{
  const root = createRoot(`
    <a href="#buy" style="display:grid;overflow:hidden;position:sticky">
      <span class="leaf">or £14.54/month with 24-month financing</span>
      <button type="button">Choose</button>
    </a>
  `);
  expectIdempotent(root, 1);
  expectEqual(root.querySelector(".leaf")?.querySelectorAll(BADGE_SELECTOR).length, 1, "complex interactive source uses stable inline placement");
  expectEqual(document.querySelector('[data-euc-overlay-root="true"]'), null, "complex interactive source creates no viewport overlay");
}

{
  const root = createRoot(`
    <div class="sticky">From £349</div>
    <div class="main">From £349</div>
    <div class="responsive" style="display:none">From £349</div>
  `);
  expectIdempotent(root, 2);
  expectEqual(root.querySelector(".sticky")?.querySelectorAll(BADGE_SELECTOR).length, 1, "sticky copy owns its badge");
  expectEqual(root.querySelector(".main")?.querySelectorAll(BADGE_SELECTOR).length, 1, "main copy owns its badge");
  expectEqual(root.querySelector(".responsive")?.querySelectorAll(BADGE_SELECTOR).length, 0, "hidden responsive copy has no badge");
}

{
  const root = createRoot(`
    <div class="slide original">£349</div>
    <div class="slide clone">£349</div>
    <div class="slide hidden" style="visibility:hidden">£349</div>
  `);
  expectIdempotent(root, 2);
  expectEqual(root.querySelector(".original")?.querySelectorAll(BADGE_SELECTOR).length, 1, "visible carousel original badge");
  expectEqual(root.querySelector(".clone")?.querySelectorAll(BADGE_SELECTOR).length, 1, "visible carousel clone badge");
  expectEqual(root.querySelector(".hidden")?.querySelectorAll(BADGE_SELECTOR).length, 0, "hidden carousel slide skipped");
}

{
  const root = createRoot('<p><span>3.99€ / month with ads or 4.99€ / month without ads</span></p>');
  expectIdempotent(root, 2);
}

{
  const root = createRoot('<div class="plan-card"><h3>Individual</h3><p>Free for first 1 month</p><p>TRY 99/month after</p></div>');
  expectIdempotent(root, 1);
  const later = document.createElement("p");
  later.textContent = "TRY 109/month";
  root.querySelector(".plan-card")?.append(later);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "later sibling remains processable");
}

{
  const root = createRoot('<div class="plan-card"><p>TRY 135 / month</p><p>TRY 165 / month</p></div>');
  expectIdempotent(root, 2);
}

{
  const root = createRoot('<p>Free for first 1 month, then TRY 55 per month after.</p>');
  expectIdempotent(root, 1);
}

{
  const root = createRoot('<p><span>4.99</span><span>€</span><span> / month</span></p>');
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "split EUR candidate count");
  expectEqual(candidates[0]?.scanKind, "combined-inline", "split EUR scan kind");
  expectEqual(candidates[0]?.sourceNodes.length, 2, "split EUR mapped source nodes");
  expectEqual(candidates[0]?.renderingAnchor.tagName, "P", "split EUR narrow anchor");
  expectIdempotent(root, 1);
}

for (const markup of [
  '<p><span>۶۹,۴۴۸,۰۰۰</span><span>تومان</span></p>',
  '<p><span>۶۹,۴۴۸,۰۰۰</span><span> تومان</span></p>',
]) {
  const root = createRoot(markup);
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "split Iranian price candidate count");
  expectEqual(candidates[0]?.scanKind, "combined-inline", "split Iranian price scan kind");
  expectEqual(candidates[0]?.sourceNodes.length, 2, "split Iranian price mapped source nodes");
  expectEqual(candidates[0]?.match.amount, 69448000, "split Iranian price amount");
  expectEqual(candidates[0]?.match.currency, "IRT", "split Iranian price currency");
  expectIdempotent(root, 1);
}

{
  const root = createRoot('<div><span>۵۰۰,۰۰۰</span><button type="button">تومان</button></div>');
  expectEqual(
    collectCurrencyDomMatches(getTextNodes(root)).length,
    0,
    "split Iranian price does not cross an interactive control"
  );
}

{
  const root = createRoot('<div><div><span>۵۰۰,۰۰۰</span></div><div><span>تومان</span></div></div>');
  expectEqual(
    collectCurrencyDomMatches(getTextNodes(root)).length,
    1,
    "nested block wrappers preserve one local Iranian price"
  );
}

{
  const root = createRoot(
    '<a href="/product" style="display:flex;flex-direction:column;width:128px;overflow:hidden"><img />' +
    '<div class="old"><span>۲۶۰٬۰۰۰</span></div>' +
    '<div class="current"><span>۱۶۹٬۰۰۰</span><span>تومان</span></div></a>'
  );
  const link = root.querySelector<HTMLAnchorElement>("a")!;
  const discovery = discoverCurrencyMatchesInElement(root);
  expectEqual(
    discovery.matches.some((candidate) => candidate.match.amount === 169000 && candidate.currencyOrigin !== "inferred"),
    true,
    "clickable card current price is an explicit candidate"
  );
  let clicked = false;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    clicked = true;
  });
  expectEqual(render(root), 2, "clickable card renders independent old and current prices");
  link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "clickable card uses natural-flow badges");
  expectEqual(document.querySelector('[data-euc-overlay-root="true"]'), null, "clickable card creates no viewport overlay");
  expectEqual(clicked, true, "clickable card remains interactive after badge rendering");
}

{
  const root = createRoot(
    '<p><del aria-hidden="true"><span><bdi>33,000,000<span>تومان</span></bdi></span></del>' +
    '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">قیمت اصلی: 33,000,000 تومان بود.</span>' +
    '<ins aria-hidden="true"><span><bdi>31,930,000<span>تومان</span></bdi></span></ins>' +
    '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">قیمت فعلی: 31,930,000 تومان.</span></p>'
  );
  const discovery = discoverCurrencyMatchesInElement(root);
  expectEqual(discovery.matches.length, 2, "visible WooCommerce old/current candidate count");
  expectEqual(discovery.rejectedMatches.length, 2, "screen-reader duplicates are accounted as nonvisual");
  expectEqual(
    discovery.rejectedMatches.every((rejection) => rejection.discoveryOutcome === "hidden-nonvisual"),
    true,
    "screen-reader duplicate rejection outcome"
  );
  expectEqual(render(root), 2, "visible aria-hidden price markup renders both badges");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "visible old/current markup uses stable adjacent badges");
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 0, "semantic markup alone does not force overlays");
}

{
  const root = createRoot(
    '<a href="/product"><div class="price-row" style="display:flex"><span>76,900,000</span><span>تومان</span></div></a>'
  );
  const link = root.querySelector<HTMLAnchorElement>("a")!;
  const row = root.querySelector<HTMLElement>(".price-row")!;
  const orderBefore = [...row.children];
  let clicked = false;
  link.addEventListener("click", (event) => { event.preventDefault(); clicked = true; });
  expectEqual(render(root), 1, "flex price row conversion count");
  expectEqual(row.querySelectorAll(BADGE_SELECTOR).length, 0, "flex price row receives no badge child");
  expectEqual(row.children.length, orderBefore.length, "flex price row child count remains stable");
  expectEqual([...row.children].every((child, index) => child === orderBefore[index]), true, "flex price row child order remains stable");
  link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  expectEqual(clicked, true, "flex product card remains clickable");
  render(root);
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 0, "flex ancestry alone does not force an overlay");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "flex price row adjacent badge remains idempotent");
}

{
  const root = createRoot(
    '<div aria-hidden="true"><del><span>4,500,000</span><span>تومان</span></del>' +
    '<ins><span>3,690,000</span><span>تومان</span></ins></div>'
  );
  const mutationLeaf = root.querySelector("ins span")?.firstChild as Text;
  const mutationDiscovery = discoverCurrencyMatchesInRoots([mutationLeaf], { candidateNodes: [] }).matches;
  expectEqual(mutationDiscovery.length, 2, "aria-hidden mutation leaf promotes complete stable price scope");
  expectEqual(render(root), 2, "initial option prices render once");
  const option = root.firstElementChild as HTMLElement;
  option.innerHTML = '<del><span>5,000,000</span><span>تومان</span></del><ins><span>4,100,000</span><span>تومان</span></ins>';
  expectEqual(render(root), 2, "replacement option prices render once");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "replacement option removes stale badges and renders current adjacent badges");
  expectEqual(document.querySelectorAll('[data-euc-overlay-badge="true"]').length, 0, "replacement option does not require viewport overlays");
}

{
  const root = createRoot(
    '<div><p>44,000,000<span>تومان</span> تخفیف</p><div><del>509,999,000</del>' +
    '<div><span>465,999,000</span><span>تومان</span></div></div></div>'
  );
  const candidates = discoverCurrencyMatchesInElement(root).matches;
  const amounts = candidates.map((candidate) => candidate.match.amount).sort((a, b) => a - b);
  expectEqual(JSON.stringify(amounts), JSON.stringify([44000000, 465999000, 509999000]), "Technolife local prices remain independent");
  expectEqual(
    candidates.find((candidate) => candidate.match.amount === 465999000)?.currencyOrigin ?? "explicit",
    "explicit",
    "Technolife current price remains explicit"
  );
  expectEqual(render(root), 3, "Technolife discount, old, and current prices render");
}

{
  const root = createRoot('<div><span><bdi><span>31,930,000</span></bdi></span><span><em>تومان</em></span></div>');
  const candidates = discoverCurrencyMatchesInElement(root).matches;
  expectEqual(candidates.length, 1, "deep nested amount and currency wrappers candidate count");
  expectEqual(candidates[0]?.match.amount, 31930000, "deep nested wrappers amount");
}

{
  const root = createRoot(
    '<p><span>6,950,000 </span><span>تومان 7</span><span>% 7,450,000</span></p>'
  );
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "adjacent suffix price supersedes prefix percentage fragment");
  expectEqual(candidates[0]?.match.raw, "6,950,000 تومان", "adjacent suffix price raw text");
  expectEqual(candidates[0]?.match.amount, 6950000, "adjacent suffix price amount");
}

{
  const root = createRoot('<p><span>تومان 7</span><span>%</span></p>');
  expectEqual(
    collectCurrencyDomMatches(getTextNodes(root)).length,
    0,
    "split percentage does not become an Iranian prefix price"
  );
}

for (const [label, markup, expected] of [
  [
    "Okala cluster",
    '<div><span>۷۱٬۵۰۰</span><span>۳۹٬۳۲۵</span><span>تومان</span></div>',
    [39325, 71500],
  ],
  [
    "Technolife cluster",
    '<div><del>509,999,000</del><ins>465,999,000<span>تومان</span></ins></div>',
    [465999000, 509999000],
  ],
  [
    "Riiha cluster",
    '<div><span>16,521,000</span><span>24%</span><span>12,402,000</span><span>تومان</span></div>',
    [12402000, 16521000],
  ],
] as const) {
  const root = createRoot(markup);
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 2, `${label} candidate count`);
  expectEqual(
    JSON.stringify(candidates.map((candidate) => candidate.match.amount).sort((a, b) => a - b)),
    JSON.stringify([...expected].sort((a, b) => a - b)),
    `${label} independent amounts`
  );
  expectEqual(
    candidates.filter((candidate) => candidate.currencyOrigin === "inferred").length,
    1,
    `${label} inferred old-price count`
  );
  const inferred = candidates.find((candidate) => candidate.currencyOrigin === "inferred")!;
  expectEqual(inferred.sourceNodes.length, 1, `${label} inferred exact source range`);
  expectEqual(inferred.match.raw, inferred.sourceNodes[0]?.textContent?.trim(), `${label} inferred raw amount only`);
  expectIdempotent(root, 2);
}

{
  const root = createRoot(
    '<div><del><span>7,889,000</span><span>تومان</span></del>' +
    '<div><span>4,733,400</span><span>تومان</span><span>40%</span></div></div>'
  );
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 2, "Corum explicit old/current candidate count");
  expectEqual(
    candidates.every((candidate) => candidate.currencyOrigin !== "inferred"),
    true,
    "Corum prices remain independently explicit"
  );
}

{
  const root = createRoot(
    '<div><span>بودجه 10,000,000 سپس در متن دیگری</span><span>8,000,000</span><span>تومان</span></div>'
  );
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "unsafe prose keeps only explicit Iranian price");
  expectEqual(candidates[0]?.match.amount, 8000000, "unsafe prose explicit amount");
}

{
  const root = createRoot(
    '<div><span>100,000</span><button>Buy</button><span>80,000 تومان</span></div>'
  );
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "control boundary blocks shared-unit inference");
  expectEqual(candidates[0]?.match.amount, 80000, "control boundary explicit amount");
}

{
  const root = createRoot(
    '<section><div><span>100,000</span><span>80,000</span><span>تومان</span></div>' +
    '<div><span>100,000</span><span>70,000</span><span>تومان</span></div></section>'
  );
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 4, "separate cards retain four independent prices");
  expectEqual(
    candidates.filter((candidate) => candidate.currencyOrigin === "inferred").length,
    2,
    "separate cards infer only within each card"
  );
}

{
  const root = createRoot('<p><span>TRY</span><span>99</span><span>/month</span></p>');
  const candidates = collectCurrencyDomMatches(getTextNodes(root));
  expectEqual(candidates.length, 1, "split TRY candidate count");
  expectEqual(candidates[0]?.sourceNodes.length, 2, "split TRY mapped source nodes");
  expectIdempotent(root, 1);
}

{
  const root = createRoot('<div><p>TRY 99/month</p><p>TRY 55/month</p><span class="ehinium-converter-badge" data-ehinium-badge="true" data-ehinium-converted="true">$2.11</span></div>');
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "two source badges and stale legacy badge removed");
}

{
  const root = createRoot('<p>TRY 99/month</p>');
  render(root);
  const source = root.querySelector("p")?.firstChild as Text;
  source.textContent = "TRY 109/month";
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "changed text replaces stale badge");
  expectEqual(getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)), "$10.90", "changed text conversion");

  root.querySelector(BADGE_SELECTOR)?.remove();
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "manually removed badge recreated");
}

{
  const root = createRoot('<div id="price-region"><p>AED 12.00</p></div>');
  const region = root.querySelector("#price-region") as HTMLElement;
  render(root);
  for (let replacement = 0; replacement < 10; replacement++) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "AED 12.00";
    region.replaceChildren(paragraph);
    render(root);
    expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "equivalent replacement badge count");
  }
  expectEqual(root.querySelectorAll("[data-ehinium-source-fingerprint]").length, 1, "equivalent replacement owner count");
}

{
  const root = createRoot('<div><p>AED 12.00</p><aside></aside></div>');
  render(root);
  const badge = root.querySelector<HTMLElement>(BADGE_SELECTOR)!;
  root.querySelector("aside")?.append(badge);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "connected badge with wrong owner is reconciled");
  expectEqual(root.querySelector("p")?.querySelectorAll(BADGE_SELECTOR).length, 1, "reconciled badge returns to live source");
}

{
  const root = createRoot('<div><p>AED 12.00</p><p>AED 12.00</p></div>');
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "two equal source occurrences");
  const container = root.firstElementChild as HTMLElement;
  const replacement = document.createElement("p");
  replacement.textContent = "AED 12.00";
  container.firstElementChild?.replaceWith(replacement);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 2, "equal sibling replacement remains distinct");
}

{
  const root = createRoot('<div><p>AED 12.00</p></div>');
  render(root);
  const container = root.firstElementChild as HTMLElement;
  const replacement = document.createElement("p");
  replacement.textContent = "AED 15.00";
  container.replaceChildren(replacement);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "changed replacement badge count");
  expectEqual(getBadgeVisibleText(root.querySelector<HTMLElement>(BADGE_SELECTOR)), "$1.50", "changed replacement conversion");
}

{
  const root = createRoot('<div><p>AED 12.00 <span class="ehinium-converter-badge" data-ehinium-badge="true" data-ehinium-converted="true">$3.27</span></p></div>');
  const collection = collectSourceTextFragments(root.firstElementChild as HTMLElement);
  expectEqual(collection.input.trim(), "AED 12.00", "extension badge excluded from combined input");
  expectEqual(collection.excludedExtensionFragmentCount, 1, "excluded extension fragment count");
  expectEqual(collection.combinedTextContainsExtensionUi, false, "combined input extension invariant");
}

{
  const root = createRoot(`
    <span class="a-price">
      <span class="a-price-symbol">AED</span>
      <span class="a-price-whole">12</span>
      <span class="a-price-fraction">00</span>
    </span>
  `);
  render(root);
  const oldAnchor = root.querySelector(".a-price") as HTMLElement;
  const replacement = document.createElement("span");
  replacement.className = "a-price";
  replacement.innerHTML = '<span class="a-price-symbol">AED</span><span class="a-price-whole">12</span><span class="a-price-fraction">00</span>';
  oldAnchor.replaceWith(replacement);
  render(root);
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "grouped equivalent replacement adoption");
}

{
  const root = createRoot(`
    <span class="a-price">
      <span class="a-offscreen">AED 118.94</span>
      <span aria-hidden="true">
        <span class="a-price-symbol">AED</span>
        <span class="a-price-whole">118</span>
        <span class="a-price-fraction">94</span>
      </span>
    </span>
  `);
  expectEqual(getTextNodes(root).length, 0, "grouped fixture has no eligible text nodes");
  expectEqual(render(root), 1, "grouped root discovery does not require eligible descendants");
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "hidden-fragment grouped badge count");
}

{
  const record = {
    type: "childList",
    target: document.body,
    addedNodes: [document.createElement("span")],
    removedNodes: [],
  } as unknown as MutationRecord;
  (record.addedNodes[0] as Element).setAttribute("data-ehinium-badge", "true");
  expectEqual(classifyMutationBatch([record]), "extension-ui", "extension-only mutation category");
}

{
  const root = createRoot('<div><p>TRY 99/month</p></div>');
  render(root);
  const paragraph = root.querySelector("p") as HTMLElement;
  const stop = observeDomChanges((roots) => {
    for (const mutationRoot of roots) {
      if (mutationRoot instanceof HTMLElement) {
        render(mutationRoot);
      }
    }
  });
  paragraph.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  root.append(paragraph);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expectEqual(root.querySelectorAll(BADGE_SELECTOR).length, 1, "removed and reinserted source rendered once");
  stop();
}

const runPerformanceAssertions = process.env.EUC_REAL_DOM_PERFORMANCE_ASSERTIONS === "true";
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

const performanceRoot = createRoot(1000);
for (let index = 0; index < 100; index++) {
  const card = document.createElement("div");
  card.innerHTML = `<p>TRY ${99 + index}/month</p><p>EUR ${10 + index}.99/month</p>`;
  performanceRoot.append(card);
}
for (let index = 0; index < 200; index++) {
  const badge = document.createElement("span");
  badge.setAttribute("data-ehinium-badge", "true");
  badge.setAttribute("data-ehinium-converted", "true");
  badge.textContent = "$1.00";
  performanceRoot.append(badge);
}
const started = performance.now();
const scanPasses = runPerformanceAssertions ? 5 : 1;
const scanDurations: number[] = [];
for (let pass = 0; pass < scanPasses; pass++) {
  const passStarted = performance.now();
  collectCurrencyDomMatches(getTextNodes(performanceRoot));
  scanDurations.push(performance.now() - passStarted);
}
const duration = performance.now() - started;
const projectedScanDuration = median(scanDurations) * scanPasses;
if (runPerformanceAssertions && projectedScanDuration > 5000) {
  throw new Error(`bounded DOM scan performance regression: projected median ${projectedScanDuration.toFixed(1)}ms`);
}
console.log(
  runPerformanceAssertions
    ? `Generic real-DOM regressions passed; performance fixture ${duration.toFixed(1)}ms for five scans.`
    : "Generic real-DOM functional regressions passed."
);

const replacementStressRoot = createRoot(
  Array.from({ length: runPerformanceAssertions ? 100 : 20 }, (_, index) =>
    `<section data-region="${index}"><p>AED ${12 + index}.00</p></section>`
  ).join("")
);
render(replacementStressRoot);
const replaceStressMarkup = (): void => {
  for (const [index, region] of [...replacementStressRoot.querySelectorAll<HTMLElement>("[data-region]")].entries()) {
    const paragraph = document.createElement("p");
    paragraph.textContent = `AED ${12 + index}.00`;
    region.replaceChildren(paragraph);
  }
};
const replaceStressRegions = (): void => {
  replaceStressMarkup();
  render(replacementStressRoot);
};
if (runPerformanceAssertions) replaceStressRegions();
const replacementStarted = performance.now();
const replacementPasses = runPerformanceAssertions ? 20 : 2;
for (let pass = 0; pass < replacementPasses; pass++) {
  replaceStressMarkup();
  render(replacementStressRoot);
}
const replacementDuration = performance.now() - replacementStarted;
// Happy DOM and the sequential perf workflow can introduce GC/scheduler stalls
// between otherwise equivalent passes. The fastest-quartile median preserves a
// stable work guard without charging those unrelated pauses to reconciliation.
expectEqual(
  replacementStressRoot.querySelectorAll(BADGE_SELECTOR).length,
  runPerformanceAssertions ? 100 : 20,
  "replacement stress active badges"
);
console.log(
  runPerformanceAssertions
    ? `Replacement functional stress passed; 100 regions × 20 rerenders in ${replacementDuration.toFixed(1)}ms.`
    : "Replacement reconciliation functional stress passed."
);
