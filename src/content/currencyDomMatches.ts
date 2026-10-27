import {
  CURRENCY_SAFE_FRAGMENT_BOUNDARY,
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
import { normalizeNumberToken } from "../utils/numberNormalizer";
import { getContentExclusionDetail, isInsideExcludedContent } from "./domExclusions";
import { getTextNodes, SCREEN_READER_ONLY_SELECTOR } from "./domScanner";
import { applyGlyphRemaps } from "./glyphCurrencyRemap";
import { isInsideGroupedPrice } from "./groupedPriceDetector";
import { detectMarkedPrices } from "./markedPriceDetector";
import { selectPriceAnchor } from "./priceAnchor";
import { incrementPerfCounter, measureSync } from "./perfDiagnostics";
import { rememberHiddenContent } from "./revealWatcher";

const PERF_DIAGNOSTICS_ENABLED = typeof __EUC_PERF_DIAGNOSTICS__ !== "undefined" && __EUC_PERF_DIAGNOSTICS__;

function parseCurrenciesForAudit(input: string): CurrencyMatch[] {
  if (!PERF_DIAGNOSTICS_ENABLED) return parseCurrencies(input);
  incrementPerfCounter("parserCalls");
  const matches = measureSync("parser-execution", () => parseCurrencies(input));
  incrementPerfCounter("parserMatches", matches.length);
  return matches;
}

export type TextFragmentMap = {
  node: Text;
  text: string;
  combinedStart: number;
  combinedEnd: number;
  parserStart: number;
  parserEnd: number;
  boundaryBefore: FragmentBoundary;
  boundaryAfter: FragmentBoundary;
};

export type FragmentBoundary = {
  kind: "same-node" | "adjacent-inline" | "sibling-element" | "block-boundary" | "control-boundary" | "line-break";
  visuallyAdjacent: boolean;
  safeForPriceJoin: boolean;
};

export type CurrencyDomMatch = {
  parserInput: string;
  match: CurrencyMatch;
  fragmentMap: TextFragmentMap[];
  sourceNodes: Text[];
  sourceElement: HTMLElement;
  renderingAnchor: HTMLElement;
  scanKind: "direct" | "combined-inline" | "cluster-explicit" | "cluster-inferred";
  currencyOrigin?: "explicit" | "inferred";
  clusterIndex?: number;
  /** Badge goes after this element (a currency icon after the number) instead of the anchor. */
  placementAfter?: HTMLElement;
  directNodeParserSucceeded: boolean;
  localCombinedScanAttempted: boolean;
  excludedExtensionFragmentCount: number;
  combinedTextContainsExtensionUi: false;
};

export type SourceTextFragmentCollection = {
  input: string;
  parserInput: string;
  fragments: TextFragmentMap[];
  excludedExtensionFragmentCount: number;
  combinedTextContainsExtensionUi: false;
};

export type DomCurrencyDiscoveryOutcome =
  | "candidate-created"
  | "duplicate-visible-candidate"
  | "hidden-nonvisual"
  | "unsafe-control-boundary"
  | "invalid-range"
  | "parser-rejected"
  | "renderer-rejected"
  | "queued-for-next-batch"
  | "adopted-by-current-batch"
  | "stale-epoch-discarded"
  | "disconnected-before-conversion"
  | "other";

export type DomCurrencyRejection = {
  discoveryOutcome: Exclude<DomCurrencyDiscoveryOutcome, "candidate-created" | "duplicate-visible-candidate">;
  sourceNode: Text;
  rejectionReason: string;
  parserMatches: CurrencyMatch[];
};

export type DomCurrencyDiscoveryResult = {
  matches: CurrencyDomMatch[];
  rejectedMatches: DomCurrencyRejection[];
  fragments: TextFragmentMap[];
};

export type DomCurrencyDiscoveryContext = {
  candidateNodes?: readonly Text[];
};

export type SourceVisibility =
  | "visible-render-source"
  | "hidden-semantic-duplicate"
  | "truly-hidden"
  | "disconnected";

const MAX_LOCAL_ANCESTOR_DEPTH = 3;
const MAX_LOCAL_TEXT_LENGTH = 512;
const MAX_LOCAL_FRAGMENTS = 24;
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4",
  "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "SECTION",
  "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);
const LOCAL_BOUNDARY_SELECTOR = [
  "button", "input", "select", "textarea", "option", "script", "style", "code",
  "pre", "[contenteditable='true']", "[data-ehinium-badge]",
  "[data-ehinium-converted]", "[data-ehinium-ignore='true']",
  "[data-euc-owned='true']", "[data-euc-badge='true']",
].join(", ");
const HARD_FRAGMENT_BOUNDARY = "\ue001";
const SAME_NODE_BOUNDARY: FragmentBoundary = {
  kind: "same-node", visuallyAdjacent: true, safeForPriceJoin: true,
};
let latestRejectedParserMatches = 0;

const RAISED_VERTICAL_ALIGN = /^(?:super|top|text-top)$|^[1-9][0-9.]*(?:px|em|ex|%)$|^0?\.[0-9]+(?:em|ex)$/u;

/**
 * Cents drawn as a raised, smaller number with no decimal point: `$399` then
 * `<sup>99</sup>` (Best Buy, `$399⁹⁹`), or a span lifted by `vertical-align`
 * or by top alignment in a flex row. Only an exact two-digit fragment right
 * after a whole number qualifies; styles are read for those few fragments only.
 */
function isRaisedCents(previous: Text, current: Text): boolean {
  if (!/^[0-9٠-٩۰-۹]{2}$/u.test((current.textContent ?? "").trim())) return false;
  if (!/[0-9٠-٩۰-۹]\s*$/u.test(previous.textContent ?? "") ||
      /[.,٫][0-9٠-٩۰-۹]{1,2}\s*$/u.test(previous.textContent ?? "")) return false;
  const centsElement = current.parentElement;
  const wholeElement = previous.parentElement;
  if (!centsElement || !wholeElement || centsElement === wholeElement || centsElement.contains(previous)) return false;
  if (centsElement.closest("sup") && !wholeElement.closest("sup")) return true;
  if (typeof getComputedStyle !== "function") return false;
  for (let element: HTMLElement | null = centsElement, depth = 0; element && depth < 2 && !element.contains(previous);
    element = element.parentElement, depth++) {
    if (RAISED_VERTICAL_ALIGN.test(getComputedStyle(element).verticalAlign)) return true;
  }
  const centsSize = Number.parseFloat(getComputedStyle(centsElement).fontSize);
  const wholeSize = Number.parseFloat(getComputedStyle(wholeElement).fontSize);
  if (!(centsSize > 0 && wholeSize > 0 && centsSize <= wholeSize * 0.8)) return false;
  // Smaller and top-aligned with the whole number (flex rows with `align-items: flex-start`).
  const centsRect = centsElement.getBoundingClientRect();
  const wholeRect = wholeElement.getBoundingClientRect();
  return wholeRect.height > 0 && centsRect.height > 0 &&
    Math.abs(centsRect.left - wholeRect.right) <= wholeSize &&
    centsRect.top + centsRect.height / 2 < wholeRect.top + wholeRect.height * 0.45;
}

/** "399" + "99" → "399.99"; a whole number grouped with dots ("1.399") takes a comma. */
function centsSeparator(parserTail: string): string {
  const whole = /[0-9٠-٩۰-۹][0-9٠-٩۰-۹.,'’\s\u00a0\u202f]*$/u.exec(parserTail)?.[0] ?? "";
  return /[0-9٠-٩۰-۹]\.[0-9٠-٩۰-۹]{3}/u.test(whole) ? "," : ".";
}

// The join rules read only the end of the parser input so far (a split price
// such as "1.399" + "." + "99" fits easily); reading all of it for every
// fragment made long containers quadratic.
const PARSER_TAIL_LENGTH = 64;

function parserBoundary(
  parserTail: string,
  currentText: string,
  boundary: FragmentBoundary,
  previousNode?: Text,
  currentNode?: Text
): string {
  if (!boundary.safeForPriceJoin) return HARD_FRAGMENT_BOUNDARY;
  if (previousNode && currentNode && isRaisedCents(previousNode, currentNode)) {
    return centsSeparator(parserTail);
  }

  // Commerce prices commonly split the decimal tail into its own inline node:
  // `353` + `,62`, or `139` + `.` + `00` with the separator in its own span
  // (IKEA, Amazon). A synthetic token boundary there changes the parser's
  // meaning to the standalone tail ("00€"). Join only these narrow, structurally
  // safe numeric shapes; ordinary word/token boundaries remain.
  if (
    /[0-9٠-٩۰-۹]\s*$/u.test(parserTail) &&
    (/^\s*[.,٫][0-9٠-٩۰-۹]{1,4}(?![0-9٠-٩۰-۹])/u.test(currentText) || /^\s*[.,٫]\s*$/u.test(currentText))
  ) {
    return "";
  }
  if (
    /[0-9٠-٩۰-۹][.,٫]$/u.test(parserTail) &&
    /^[0-9٠-٩۰-۹]{1,4}(?![0-9٠-٩۰-۹])/u.test(currentText)
  ) {
    return "";
  }

  return CURRENCY_SAFE_FRAGMENT_BOUNDARY;
}

export function getCurrencyDomDiscoveryCounters(): { rejectedParserMatches: number } {
  return { rejectedParserMatches: latestRejectedParserMatches };
}

function boundaryBetween(previous: Text, current: Text, container: HTMLElement): FragmentBoundary {
  if (/\r?\n\s*$/u.test(previous.textContent ?? "") || /^\s*\r?\n/u.test(current.textContent ?? "")) {
    return { kind: "line-break", visuallyAdjacent: false, safeForPriceJoin: false };
  }
  const previousControl = previous.parentElement?.closest(LOCAL_BOUNDARY_SELECTOR);
  const currentControl = current.parentElement?.closest(LOCAL_BOUNDARY_SELECTOR);
  if (previousControl !== currentControl && (previousControl || currentControl)) {
    return { kind: "control-boundary", visuallyAdjacent: false, safeForPriceJoin: false };
  }
  const previousParent = previous.parentElement;
  const currentParent = current.parentElement;
  if (previousParent === currentParent) {
    return { kind: "adjacent-inline", visuallyAdjacent: true, safeForPriceJoin: true };
  }
  if (
    (previousParent && BLOCK_TAGS.has(previousParent.tagName) && previousParent !== container) ||
    (currentParent && BLOCK_TAGS.has(currentParent.tagName) && currentParent !== container)
  ) {
    const visuallyAdjacent = hasCompactPriceGeometry(previous, current);
    return { kind: "block-boundary", visuallyAdjacent, safeForPriceJoin: visuallyAdjacent };
  }
  return { kind: "sibling-element", visuallyAdjacent: true, safeForPriceJoin: true };
}

export function collectSourceTextFragments(
  container: HTMLElement,
  eligibleNodes?: ReadonlySet<Text>,
  preserveFragmentBoundaries = false
): SourceTextFragmentCollection {
  const fragments: TextFragmentMap[] = [];
  let input = "";
  let parserInput = "";
  let parserTail = "";
  let excludedExtensionFragmentCount = 0;
  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT
  );
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const text = node.textContent ?? "";
    const exclusion = getContentExclusionDetail(node);

    if (exclusion?.category === "extension-ui") {
      excludedExtensionFragmentCount++;
    } else if (
      (!eligibleNodes || eligibleNodes.has(node)) &&
      text &&
      !isInsideExcludedContent(node)
    ) {
      const previous = fragments.at(-1);
      const boundaryBefore = previous && preserveFragmentBoundaries
        ? boundaryBetween(previous.node, node, container)
        : SAME_NODE_BOUNDARY;
      if (previous && preserveFragmentBoundaries) {
        previous.boundaryAfter = boundaryBefore;
        const separator = parserBoundary(parserTail, text, boundaryBefore, previous.node, node);
        parserInput += separator;
        parserTail += separator;
      }
      const combinedStart = input.length;
      const parserStart = parserInput.length;
      input += text;
      parserInput += text;
      if (preserveFragmentBoundaries) parserTail = (parserTail + text).slice(-PARSER_TAIL_LENGTH);
      fragments.push({
        node, text, combinedStart, combinedEnd: input.length,
        parserStart, parserEnd: parserInput.length,
        boundaryBefore, boundaryAfter: SAME_NODE_BOUNDARY,
      });
    }

    current = walker.nextNode();
  }

  return {
    input,
    parserInput,
    fragments,
    excludedExtensionFragmentCount,
    combinedTextContainsExtensionUi: false,
  };
}

let sourceTextMemo: WeakMap<HTMLElement, string> | null = null;

/**
 * Within one render pass the page's own text does not change (badges and other
 * extension UI are excluded from it), so a container shared by many prices,
 * such as a product list, is read once instead of once per price.
 */
export function withSourceTextMemo<T>(work: () => T): T {
  const outer = sourceTextMemo;
  sourceTextMemo = outer ?? new WeakMap();
  try {
    return work();
  } finally {
    sourceTextMemo = outer;
  }
}

/** The source text of `container` (extension UI excluded), memoized during a render pass. */
export function sourceTextOf(container: HTMLElement): string {
  const cached = sourceTextMemo?.get(container);
  if (cached !== undefined) return cached;
  const text = collectSourceTextFragments(container).input;
  sourceTextMemo?.set(container, text);
  return text;
}

function collectFragments(
  container: HTMLElement,
  eligibleNodes: ReadonlySet<Text>
): SourceTextFragmentCollection | null {
  if (container.matches(LOCAL_BOUNDARY_SELECTOR)) {
    return null;
  }

  const collection = collectSourceTextFragments(container, eligibleNodes, true);
  if (
    collection.fragments.length < 2 ||
    collection.fragments.length > MAX_LOCAL_FRAGMENTS ||
    collection.parserInput.length > MAX_LOCAL_TEXT_LENGTH
  ) {
    return null;
  }

  return collection;
}

function mapParserMatch(
  collection: SourceTextFragmentCollection,
  match: CurrencyMatch
): CurrencyMatch | null {
  const startFragment = collection.fragments.find(
    (fragment) => match.start >= fragment.parserStart && match.start < fragment.parserEnd
  );
  const endFragment = collection.fragments.find(
    (fragment) => match.end > fragment.parserStart && match.end <= fragment.parserEnd
  );
  if (!startFragment || !endFragment) return null;
  const start = startFragment.combinedStart + match.start - startFragment.parserStart;
  const end = endFragment.combinedStart + match.end - endFragment.parserStart;
  return { ...match, start, end, raw: collection.input.slice(start, end) };
}

function parseFragmentCollection(collection: SourceTextFragmentCollection): CurrencyMatch[] {
  return parseCurrenciesForAudit(collection.parserInput)
    .map((match) => mapParserMatch(collection, match))
    .filter((match): match is CurrencyMatch => match !== null);
}

function fragmentsForMatch(
  fragments: readonly TextFragmentMap[],
  match: CurrencyMatch
): TextFragmentMap[] {
  return fragments.filter(
    (fragment) =>
      match.start < fragment.combinedEnd && fragment.combinedStart < match.end
  );
}

function lowestCommonElement(nodes: readonly Text[]): HTMLElement | null {
  const firstParent = nodes[0]?.parentElement;

  if (!firstParent) {
    return null;
  }

  let candidate: HTMLElement | null = firstParent;
  while (candidate && !nodes.every((node) => candidate?.contains(node))) {
    candidate = candidate.parentElement;
  }

  return candidate;
}

function directDomMatches(node: Text): CurrencyDomMatch[] {
  const parserInput = node.textContent ?? "";
  const sourceElement = node.parentElement;

  if (!sourceElement) {
    return [];
  }

  return parseCurrenciesForAudit(parserInput).flatMap((match) => {
    const selection = selectPriceAnchor([node], parserInput, match);
    const renderingAnchor = selection.anchor;
    if (!renderingAnchor) {
      if (selection.candidates[0]?.rejectedRule === "hidden-candidate") rememberHiddenContent(sourceElement);
      return [];
    }
    return [{
    parserInput,
    match,
    fragmentMap: [{
      node, text: parserInput, combinedStart: 0, combinedEnd: parserInput.length,
      parserStart: 0, parserEnd: parserInput.length,
      boundaryBefore: SAME_NODE_BOUNDARY, boundaryAfter: SAME_NODE_BOUNDARY,
    }],
    sourceNodes: [node],
    sourceElement,
    renderingAnchor,
    scanKind: "direct",
    directNodeParserSucceeded: true,
    localCombinedScanAttempted: false,
    excludedExtensionFragmentCount: 0,
    combinedTextContainsExtensionUi: false,
    }];
  });
}

function isIranianPrefixMatch(match: CurrencyMatch): boolean {
  return (
    (match.currency === "IRT" || match.currency === "IRR") &&
    !/^[\s(]*[+-]?[0-9٠-٩۰-۹.,٫]/u.test(match.raw)
  );
}

function isSupersededIranianPrefixMatch(
  candidate: CurrencyDomMatch,
  eligibleNodes: ReadonlySet<Text>
): boolean {
  if (!isIranianPrefixMatch(candidate.match)) return false;

  const sourceNode = candidate.sourceNodes[0];
  let container = sourceNode?.parentElement ?? null;

  for (let depth = 0; container && depth < MAX_LOCAL_ANCESTOR_DEPTH; depth++) {
    const local = collectFragments(container, eligibleNodes);
    const sourceFragment = local?.fragments.find(
      (fragment) => fragment.node === sourceNode
    );

    if (local && sourceFragment) {
      const combinedStart = sourceFragment.combinedStart + candidate.match.start;
      const combinedEnd = sourceFragment.combinedStart + candidate.match.end;
      const followedByPercentage = /^[\s\u00a0\u202f\u2009\u200c-\u200f\u202a-\u202e\u2066-\u2069]*[%٪]/u
        .test(local.input.slice(combinedEnd));
      const ownedByPrecedingSuffix = parseFragmentCollection(local).some(
        (match) =>
          match.currency === candidate.match.currency &&
          match.start < combinedStart &&
          match.end > combinedStart
      );

      if (followedByPercentage || ownedByPrecedingSuffix) return true;
    }

    container = container.parentElement;
  }

  return false;
}

type AmountFragment = {
  fragment: TextFragmentMap;
  amount: number;
  start: number;
  end: number;
};

function exactAmountFragment(fragment: TextFragmentMap): AmountFragment | null {
  const match = fragment.text.match(
    /^\s*([+-]?(?:[0-9٠-٩۰-۹]{1,3}(?:[ ,.\u00a0\u202f\u2009'’٬٫][0-9٠-٩۰-۹]{3})+|[0-9٠-٩۰-۹]+))\s*$/u
  );
  const normalized = match ? normalizeNumberToken(match[1]) : null;
  if (!match || !normalized || normalized.value < 100) return null;
  const start = fragment.text.indexOf(match[1]);
  return { fragment, amount: normalized.value, start, end: start + match[1].length };
}

function isPercentageFragment(fragment: TextFragmentMap): boolean {
  return /^\s*(?:[0-9٠-٩۰-۹]+\s*[%٪]|[%٪]\s*[0-9٠-٩۰-۹]+)\s*$/u.test(fragment.text);
}

function hasCompactPriceGeometry(first: Text, second: Text): boolean {
  const firstRect = first.parentElement?.getBoundingClientRect();
  const secondRect = second.parentElement?.getBoundingClientRect();
  if (!firstRect || !secondRect || firstRect.width <= 0 || firstRect.height <= 0 || secondRect.width <= 0 || secondRect.height <= 0) {
    return true;
  }
  const verticalDistance = Math.abs(
    firstRect.top + firstRect.height / 2 - (secondRect.top + secondRect.height / 2)
  );
  const horizontalGap = Math.max(
    0,
    Math.max(firstRect.left, secondRect.left) - Math.min(firstRect.right, secondRect.right)
  );
  return verticalDistance <= Math.max(firstRect.height, secondRect.height) * 2 &&
    horizontalGap <= Math.max(firstRect.width, secondRect.width) * 4;
}

function createClusterDomMatch(
  collection: SourceTextFragmentCollection,
  match: CurrencyMatch,
  scanKind: "cluster-explicit" | "cluster-inferred",
  clusterIndex: number
): CurrencyDomMatch | null {
  const mappedFragments = fragmentsForMatch(collection.fragments, match);
  const sourceNodes = mappedFragments.map((fragment) => fragment.node);
  const commonElement = lowestCommonElement(sourceNodes);
  const sourceElement = sourceNodes[0]?.parentElement;
  const renderingAnchor = commonElement
    ? selectPriceAnchor(sourceNodes, sourceNodes.map((node) => node.textContent ?? "").join("")).anchor
    : null;
  if (!sourceElement || !renderingAnchor) return null;
  return {
    parserInput: collection.input,
    match,
    fragmentMap: collection.fragments,
    sourceNodes,
    sourceElement,
    renderingAnchor,
    scanKind,
    currencyOrigin: scanKind === "cluster-inferred" ? "inferred" : "explicit",
    clusterIndex,
    directNodeParserSucceeded: false,
    localCombinedScanAttempted: true,
    excludedExtensionFragmentCount: collection.excludedExtensionFragmentCount,
    combinedTextContainsExtensionUi: false,
  };
}

function discoverIranianPriceClusters(
  textNodes: readonly Text[],
  existing: CurrencyDomMatch[]
): CurrencyDomMatch[] {
  if (!textNodes.some((node) =>
    // Letters may not touch the code: "irt" inside "first" or "shirt" is no toman.
    /(?<![A-Za-z])(?:IRT|IRR|TMN|Tomans?|Rials?)(?![A-Za-z])|تومان|تومن|ریال/iu.test(node.textContent ?? "")
  )) return [];
  const eligibleNodes = new Set(textNodes);
  const containers = new Set<HTMLElement>();
  for (const node of textNodes) {
    let container = node.parentElement;
    for (let depth = 0; container && depth < MAX_LOCAL_ANCESTOR_DEPTH; depth++) {
      containers.add(container);
      container = container.parentElement;
    }
  }

  const inferred: CurrencyDomMatch[] = [];
  const inferredSourceNodes = new Set<Text>();
  let clusterIndex = 0;
  for (const container of containers) {
    const collection = collectFragments(container, eligibleNodes);
    if (!collection || collection.fragments.length > 4) continue;
    const amounts = collection.fragments
      .map(exactAmountFragment)
      .filter((amount): amount is AmountFragment => amount !== null);
    if (amounts.length !== 2) continue;
    if (!hasCompactPriceGeometry(amounts[0].fragment.node, amounts[1].fragment.node)) continue;
    const firstLink = amounts[0].fragment.node.parentElement?.closest("a");
    const secondLink = amounts[1].fragment.node.parentElement?.closest("a");
    if (firstLink !== secondLink && (firstLink || secondLink)) continue;
    const percentages = collection.fragments.filter(isPercentageFragment);
    if (percentages.length > 1) continue;
    const explicitMatches = parseFragmentCollection(collection).filter(
      (match) =>
        (match.currency === "IRT" || match.currency === "IRR") &&
        match.amount === amounts[1].amount
    );
    const explicit = explicitMatches[0];
    if (!explicit || amounts[0].amount < amounts[1].amount) continue;
    const firstIndex = collection.fragments.indexOf(amounts[0].fragment);
    const lastExplicitFragment = fragmentsForMatch(collection.fragments, explicit).at(-1);
    const lastIndex = lastExplicitFragment
      ? collection.fragments.indexOf(lastExplicitFragment)
      : -1;
    if (firstIndex < 0 || lastIndex < firstIndex) continue;
    const clusterFragments = collection.fragments.slice(firstIndex, lastIndex + 1);
    if (clusterFragments.some((fragment, index) =>
      index > 0 && !fragment.boundaryBefore.safeForPriceJoin
    )) continue;
    if (clusterFragments.some((fragment) =>
      !amounts.some((amount) => amount.fragment === fragment) &&
      !isPercentageFragment(fragment) &&
      !(fragment.combinedStart < explicit.end && explicit.start < fragment.combinedEnd)
    )) continue;

    clusterIndex++;
    const explicitSourceNodes = fragmentsForMatch(collection.fragments, explicit)
      .map((fragment) => fragment.node);
    let explicitDom = existing.find(
      (candidate) =>
        candidate.match.currency === explicit.currency &&
        candidate.match.amount === explicit.amount &&
        explicitSourceNodes.every((node) => candidate.sourceNodes.includes(node))
    );
    if (!explicitDom) {
      explicitDom = createClusterDomMatch(collection, explicit, "cluster-explicit", clusterIndex) ?? undefined;
      if (explicitDom) existing.push(explicitDom);
    }
    if (explicitDom) {
      explicitDom.currencyOrigin = "explicit";
      explicitDom.clusterIndex = clusterIndex;
    }

    const old = amounts[0];
    if (inferredSourceNodes.has(old.fragment.node)) continue;
    inferredSourceNodes.add(old.fragment.node);
    const inferredMatch: CurrencyMatch = {
      raw: old.fragment.text.slice(old.start, old.end),
      amount: old.amount,
      currency: explicit.currency,
      start: old.fragment.combinedStart + old.start,
      end: old.fragment.combinedStart + old.end,
      tokenType: "localized-name",
      confidence: percentages.length > 0 ? 0.8 : 0.7,
    };
    const domMatch = createClusterDomMatch(
      collection, inferredMatch, "cluster-inferred", clusterIndex
    );
    if (domMatch) inferred.push(domMatch);
  }
  return inferred;
}

/** The next eligible text node in document order within a short distance. */
function nextEligibleTextNode(node: Text, eligibleNodes: ReadonlySet<Text>): Text | null {
  const scope = node.parentElement?.parentElement?.parentElement ?? node.parentElement;
  if (!scope) return null;
  const walker = node.ownerDocument.createTreeWalker(scope, 4);
  walker.currentNode = node;
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const text = next as Text;
    if (!(text.textContent ?? "").trim()) continue;
    return eligibleNodes.has(text) ? text : null;
  }
  return null;
}

/**
 * "$399" in one node followed by ".99" (or "." then "99") in the next is one
 * price; the node joins the split-fragment scan so the cents are not lost.
 */
function continuesInNextFragment(
  node: Text,
  matches: readonly CurrencyDomMatch[],
  eligibleNodes: ReadonlySet<Text>
): boolean {
  const text = node.textContent ?? "";
  const endsAtNodeEnd = matches.some((candidate) => candidate.match.end === text.trimEnd().length &&
    /[0-9٠-٩۰-۹]$/u.test(candidate.match.raw.trimEnd()));
  if (!endsAtNodeEnd) return false;
  const next = nextEligibleTextNode(node, eligibleNodes);
  return !!next && (/^\s*[.,٫](?:[0-9٠-٩۰-۹]{1,2}(?![0-9٠-٩۰-۹])|\s*$)/u.test(next.textContent ?? "") ||
    isRaisedCents(node, next));
}

/**
 * A match on fewer fragments that a longer match of the same currency extends
 * from the same start ("$109" inside "$109.99") is the same price, cut short.
 * `sameStart` holds the matches that start at the candidate's first node.
 */
function isSubsumedByLongerMatch(candidate: CurrencyDomMatch, sameStart: readonly CurrencyDomMatch[]): boolean {
  return sameStart.some((other) =>
    other !== candidate &&
    other.match.currency === candidate.match.currency &&
    other.sourceNodes.length > candidate.sourceNodes.length &&
    candidate.sourceNodes.every((node) => other.sourceNodes.includes(node))
  );
}

function groupByFirstNode(matches: readonly CurrencyDomMatch[]): Map<Text | undefined, CurrencyDomMatch[]> {
  const groups = new Map<Text | undefined, CurrencyDomMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.sourceNodes[0]);
    if (group) group.push(match);
    else groups.set(match.sourceNodes[0], [match]);
  }
  return groups;
}

export function collectCurrencyDomMatches(
  textNodes: readonly Text[]
): CurrencyDomMatch[] {
  const uniqueTextNodes = [...new Set(textNodes)];
  const results: CurrencyDomMatch[] = [];
  const nodesWithoutDirectMatches: Text[] = [];
  const parsedContainers = new Set<HTMLElement>();
  const allEligibleNodes = new Set(uniqueTextNodes);

  for (const node of uniqueTextNodes) {
    const direct = directDomMatches(node);
    const retainedDirect = direct.filter(
      (candidate) =>
        !isSupersededIranianPrefixMatch(candidate, allEligibleNodes)
    );
    results.push(...retainedDirect);
    // "$399" followed by ".99" also joins the split-fragment scan; the longer
    // price replaces the direct one only when it exists ("$10" then "." stays).
    if (retainedDirect.length === 0 || continuesInNextFragment(node, retainedDirect, allEligibleNodes)) {
      nodesWithoutDirectMatches.push(node);
    }
  }

  const combinedEligibleNodes = new Set(nodesWithoutDirectMatches);

  for (const node of nodesWithoutDirectMatches) {
    let container = node.parentElement;

    for (let depth = 0; container && depth < MAX_LOCAL_ANCESTOR_DEPTH; depth++) {
      if (parsedContainers.has(container)) {
        break;
      }

      parsedContainers.add(container);
      const local = collectFragments(container, combinedEligibleNodes);
      if (local) {
        const matches = parseFragmentCollection(local);

        for (const match of matches) {
          const mappedFragments = fragmentsForMatch(local.fragments, match);
          const sourceNodes = mappedFragments.map((fragment) => fragment.node);

          // A local scan exists to discover expressions spanning DOM fragments.
          // Matches contained by one node are owned by that node's direct pass.
          if (sourceNodes.length < 2) {
            continue;
          }

          const commonElement = lowestCommonElement(sourceNodes);
          const sourceElement = sourceNodes[0]?.parentElement;
          const renderingAnchor = commonElement
            ? selectPriceAnchor(
                sourceNodes,
                sourceNodes.map((sourceNode) => sourceNode.textContent ?? "").join("")
              ).anchor
            : null;
          if (!renderingAnchor || !sourceElement) {
            continue;
          }

          results.push({
            parserInput: local.input,
            match,
            fragmentMap: local.fragments,
            sourceNodes,
            sourceElement,
            renderingAnchor,
            scanKind: "combined-inline",
            directNodeParserSucceeded: false,
            localCombinedScanAttempted: true,
            excludedExtensionFragmentCount: local.excludedExtensionFragmentCount,
            combinedTextContainsExtensionUi: false,
          });
        }

        if (matches.length > 0) {
          break;
        }
      }

      container = container.parentElement;
    }
  }

  results.push(...discoverIranianPriceClusters(uniqueTextNodes, results));

  const byFirstNode = groupByFirstNode(results);
  const accepted = results.filter((candidate) =>
    !isSubsumedByLongerMatch(candidate, byFirstNode.get(candidate.sourceNodes[0]) ?? [])
  ).filter((candidate, index, all) =>
    all.findIndex((other) =>
      other.match.currency === candidate.match.currency &&
      other.match.amount === candidate.match.amount &&
      other.match.raw === candidate.match.raw &&
      (other.currencyOrigin ?? "explicit") === (candidate.currencyOrigin ?? "explicit") &&
      other.sourceNodes.length === candidate.sourceNodes.length &&
      other.sourceNodes.every((node, nodeIndex) => node === candidate.sourceNodes[nodeIndex])
    ) === index
  );
  latestRejectedParserMatches = Math.max(0, results.length - accepted.length);
  if (PERF_DIAGNOSTICS_ENABLED) {
    incrementPerfCounter("directTextParserMatches", accepted.filter((match) => match.scanKind === "direct" && match.clusterIndex === undefined).length);
    incrementPerfCounter("splitTextParserMatches", accepted.filter((match) => match.scanKind === "combined-inline" && match.clusterIndex === undefined).length);
    incrementPerfCounter("clusterExplicitMatches", accepted.filter((match) => match.currencyOrigin === "explicit" && match.clusterIndex !== undefined).length);
    incrementPerfCounter("clusterInferredMatches", accepted.filter((match) => match.currencyOrigin === "inferred").length);
    incrementPerfCounter("rejectedParserMatches", latestRejectedParserMatches);
  }
  return accepted;
}

function nonvisualReason(
  node: Text,
  cache: WeakMap<HTMLElement, string | null>
): string | null {
  const element = node.parentElement;
  if (!element) return "Source text has no visual parent";
  if (cache.has(element)) return cache.get(element) ?? null;
  if (element.closest("[hidden]") || element.closest('[style*="display: none"], [style*="display:none"]')) {
    cache.set(element, "Source text is hidden by layout markup");
    return cache.get(element)!;
  }

  const rect = element.getBoundingClientRect();
  const inlineStyle = element.getAttribute("style") ?? "";
  const needsComputedVisibility = rect.width <= 1 || rect.height <= 1 ||
    /(?:clip|overflow|visibility|opacity|display)\s*:/iu.test(inlineStyle);
  if (!needsComputedVisibility) {
    cache.set(element, null);
    return null;
  }
  const style = (typeof getComputedStyle === "function"
    ? getComputedStyle(element)
    : element.ownerDocument.defaultView?.getComputedStyle(element));
  if (!style) {
    cache.set(element, null);
    return null;
  }
  let reason: string | null = null;
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" ||
      (style.opacity !== "" && Number(style.opacity) === 0)) {
    reason = "Source text is hidden by computed layout";
  } else {
    const clipped = style.clip !== "" && style.clip !== "auto" ||
      style.clipPath !== "" && style.clipPath !== "none";
    if ((Number.parseFloat(style.width) <= 1 || rect.width <= 1) &&
        (Number.parseFloat(style.height) <= 1 || rect.height <= 1) &&
        (style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden" || clipped)) {
      reason = "Source text is visually clipped semantic content";
    }
  }
  cache.set(element, reason);
  return reason;
}

export function classifyCurrencySourceVisibility(node: Text): SourceVisibility {
  if (!node.isConnected) return "disconnected";
  if (isInsideExcludedContent(node)) return "truly-hidden";
  const reason = nonvisualReason(node, new WeakMap());
  if (!reason) return "visible-render-source";
  return reason.includes("clipped semantic")
    ? "hidden-semantic-duplicate"
    : "truly-hidden";
}

function textNodesUnder(root: Node): Text[] {
  if (root instanceof Text) return [root];
  const nodes: Text[] = [];
  const ownerDocument = root.ownerDocument ?? document;
  const showText = ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = ownerDocument.createTreeWalker(root, showText);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

type VisuallyHiddenKind = "screen-reader" | "hidden";

/**
 * Screen-reader-only text that no class name gives away (an absolutely
 * positioned 1px box, `clip: rect(0 0 0 0)`, `clip-path: inset(50%)`), or
 * content hidden for now (`display: none`, `opacity: 0`) that the page may
 * reveal later. Only checked for the few nodes that produced a price.
 */
function visuallyHiddenKind(
  element: Element,
  cache: WeakMap<Element, VisuallyHiddenKind | null>
): VisuallyHiddenKind | null {
  for (let current: Element | null = element, depth = 0; current && depth < 4; current = current.parentElement, depth++) {
    let kind = cache.get(current);
    if (kind === undefined) {
      const style = typeof getComputedStyle === "function" ? getComputedStyle(current) : null;
      kind = null;
      if (style) {
        const positioned = style.position === "absolute" || style.position === "fixed";
        const clipped = /rect\(\s*[01]px[,\s]+[01]px[,\s]+[01]px[,\s]+[01]px\s*\)/u.test(style.clip ?? "") ||
          /inset\(\s*(?:50|100)%/u.test(style.clipPath ?? "");
        const tiny = positioned && (Number.parseFloat(style.width) <= 1 || Number.parseFloat(style.height) <= 1) &&
          (style.overflow === "hidden" || style.overflowX === "hidden" || style.overflow === "clip");
        if ((positioned && clipped) || tiny) kind = "screen-reader";
        else if (style.display === "none" || style.visibility === "hidden" ||
          (style.opacity !== "" && Number(style.opacity) === 0)) kind = "hidden";
      }
      cache.set(current, kind);
    }
    if (kind) return kind;
  }
  return null;
}

const MAX_PRICE_SCOPE_TEXT_LENGTH = 120;
const INLINE_ROOT_TAGS = new Set([
  "SPAN", "B", "STRONG", "SMALL", "SUP", "SUB", "DATA", "EM", "I", "A", "DEL", "INS", "S", "BDI", "FONT", "U",
]);

/**
 * A mutation often touches one fragment of a split price ("4,500,000" while
 * "تومان" sits in the next span). A text or inline root grows to the short
 * ancestor that holds the whole price so the fragments are read together.
 * Element roots such as a section are deliberate boundaries and stay as given.
 */
function priceScopeNodes(root: Node): Text[] {
  if (root instanceof Element && !INLINE_ROOT_TAGS.has(root.tagName)) return [];
  let element = root instanceof Element ? root : root.parentElement;
  if (!element || (element.textContent?.length ?? 0) > MAX_PRICE_SCOPE_TEXT_LENGTH) return [];
  for (let depth = 0; depth < 3; depth++) {
    const parent: HTMLElement | null = element.parentElement;
    if (!parent || parent === element.ownerDocument.body ||
        (parent.textContent?.length ?? 0) > MAX_PRICE_SCOPE_TEXT_LENGTH) break;
    element = parent;
  }
  return getTextNodes(element);
}

/** Shared visibility-aware DOM discovery used by production and diagnostics. */
export function discoverCurrencyMatchesInRoots(
  roots: readonly Node[],
  context: DomCurrencyDiscoveryContext = {}
): DomCurrencyDiscoveryResult {
  const allNodes = [...new Set([
    ...(context.candidateNodes ?? []),
    ...roots.flatMap(context.candidateNodes ? priceScopeNodes : textNodesUnder),
  ])].filter((node) => {
    const parent = node.parentElement;
    return !!node.textContent?.trim() && !isInsideExcludedContent(node) && !!parent &&
      !parent.closest(SCREEN_READER_ONLY_SELECTOR) &&
      // Amazon `.a-price` groups are converted as a whole by the grouped detector.
      !isInsideGroupedPrice(parent);
  });
  const rejectedMatches: DomCurrencyRejection[] = [];
  const visibilityCache = new WeakMap<HTMLElement, string | null>();
  const seededNodes = new Set(context.candidateNodes ?? []);
  const visibleNodes = allNodes.filter((node) => {
    // Scanner-owned nodes retain their existing production eligibility. Layout
    // clipping is revalidated during canonicalization; supplemental aria-hidden
    // nodes need the stricter visual check here.
    if (seededNodes.has(node) &&
        !/(?:clip|overflow|visibility|opacity|display)\s*:/iu.test(node.parentElement?.getAttribute("style") ?? "")) {
      return true;
    }
    const reason = nonvisualReason(node, visibilityCache);
    if (!reason) return true;
    const parserMatches = parseCurrenciesForAudit(node.textContent ?? "");
    if (parserMatches.length > 0) {
      rejectedMatches.push({
        discoveryOutcome: "hidden-nonvisual",
        sourceNode: node,
        rejectionReason: reason,
        parserMatches,
      });
    }
    return false;
  });
  // Per pass: content hidden now may be revealed before the next scan.
  const hiddenKindCache = new WeakMap<Element, VisuallyHiddenKind | null>();
  const matches = collectCurrencyDomMatches(visibleNodes).filter((match) => {
    const kinds = match.sourceNodes.map((node) =>
      node.parentElement ? visuallyHiddenKind(node.parentElement, hiddenKindCache) : null);
    const kind = kinds.find((value) => value !== null) ?? null;
    if (kind) {
      rejectedMatches.push({
        discoveryOutcome: "hidden-nonvisual",
        sourceNode: match.sourceNodes[0],
        rejectionReason: kind === "screen-reader"
          ? "Source text is a visually hidden screen-reader copy"
          : "Source text is hidden until the page reveals it",
        parserMatches: [match.match],
      });
      if (kind === "hidden" && !kinds.includes("screen-reader")) rememberHiddenContent(match.sourceElement);
    }
    return !kind;
  });
  matches.push(...detectMarkedPrices(roots, matches));
  const remapped = applyGlyphRemaps(matches);
  return {
    matches: remapped,
    rejectedMatches,
    fragments: remapped.flatMap((match) => match.fragmentMap),
  };
}

export function discoverCurrencyMatchesInElement(
  element: Element,
  context: DomCurrencyDiscoveryContext = {}
): DomCurrencyDiscoveryResult {
  return discoverCurrencyMatchesInRoots([element], context);
}
