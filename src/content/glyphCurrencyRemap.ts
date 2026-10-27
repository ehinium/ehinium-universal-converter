import { resolveCurrencySymbol } from "../utils/currencyParser";
import type { CurrencyDomMatch } from "./currencyDomMatches";

/**
 * Shops draw a sign that fonts lack (the 2025 Saudi riyal sign) by replacing
 * another glyph in their own web font. extra.com says so in its markup: the
 * sign is `::before { content: "€" }` on an element whose hidden label reads
 * "SAR". Wherever that font shows "€", the reader sees the riyal, so matches of
 * "€" set in that font are riyal prices. Nothing changes on pages without such
 * a label, or for text in any other font.
 */

type GlyphRemap = { symbol: string; fontFamily: string; currency: string };

const MAX_INSPECTED_MARKER_CLASSES = 40;
const remaps: GlyphRemap[] = [];
const inspectedMarkerClasses = new Set<string>();

function firstFontFamily(fontFamily: string): string {
  return (fontFamily.split(",")[0] ?? "").trim().replace(/^["']|["']$/gu, "").toLowerCase();
}

/** Learns a remap from a currency label element that draws a different sign. */
export function learnGlyphRemap(marker: Element, labelCurrency: string): void {
  // Styles that arrive later (lazy stylesheets) get a fresh look at the class.
  const key = `${marker.ownerDocument.styleSheets.length}:${marker.tagName}.${marker.getAttribute("class") ?? ""}`;
  if (inspectedMarkerClasses.has(key) || inspectedMarkerClasses.size >= MAX_INSPECTED_MARKER_CLASSES) return;
  inspectedMarkerClasses.add(key);
  const view = marker.ownerDocument.defaultView;
  if (!view) return;
  for (const pseudo of ["::before", "::after"]) {
    const style = view.getComputedStyle(marker, pseudo);
    const symbol = /^["'](\S{1,3})["']$/u.exec(style.content ?? "")?.[1];
    if (!symbol || !/\p{Sc}/u.test(symbol)) continue;
    const drawnCurrency = resolveCurrencySymbol(symbol, null);
    const fontFamily = firstFontFamily(style.fontFamily ?? "");
    if (!drawnCurrency || drawnCurrency === labelCurrency || !fontFamily) continue;
    if (!remaps.some((remap) => remap.symbol === symbol && remap.fontFamily === fontFamily)) {
      remaps.push({ symbol, fontFamily, currency: labelCurrency });
    }
  }
}

/** Re-labels symbol matches drawn in a font that remaps their sign. */
export function applyGlyphRemaps(matches: CurrencyDomMatch[]): CurrencyDomMatch[] {
  if (remaps.length === 0) return matches;
  const fontCache = new Map<Element, string>();
  return matches.map((candidate) => {
    const { match } = candidate;
    if (match.tokenType !== "symbol") return candidate;
    const remap = remaps.find((entry) =>
      match.raw.includes(entry.symbol) && resolveCurrencySymbol(entry.symbol) === match.currency);
    if (!remap) return candidate;
    const symbolNode = candidate.sourceNodes.find((node) => (node.textContent ?? "").includes(remap.symbol));
    const element = symbolNode?.parentElement;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) return candidate;
    let fontFamily = fontCache.get(element);
    if (fontFamily === undefined) {
      fontFamily = firstFontFamily(view.getComputedStyle(element).fontFamily ?? "");
      fontCache.set(element, fontFamily);
    }
    return fontFamily === remap.fontFamily
      ? { ...candidate, match: { ...match, currency: remap.currency } }
      : candidate;
  });
}

/** Test hook. */
export function resetGlyphRemaps(): void {
  remaps.length = 0;
  inspectedMarkerClasses.clear();
}
