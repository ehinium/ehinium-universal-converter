import {
  CURRENCY_SAFE_FRAGMENT_BOUNDARY,
  parseCurrencies,
  type CurrencyMatch,
} from "../utils/currencyParser";
import { normalizeNumberToken } from "../utils/numberNormalizer";
import { getContentExclusionDetail, isInsideExcludedContent } from "./domExclusions";
import { selectPriceAnchor } from "./priceAnchor";
import { incrementPerfCounter, measureSync } from "./perfDiagnostics";

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

function parserBoundary(
  previousText: string,
  currentText: string,
  boundary: FragmentBoundary
): string {
  if (!boundary.safeForPriceJoin) return HARD_FRAGMENT_BOUNDARY;

  // Commerce prices commonly split the decimal tail into its own inline node.
  // Keeping a synthetic token boundary between `353` and `,62` changes the
  // parser's meaning to the standalone fractional tail. Join only this narrow,
  // structurally safe numeric shape; ordinary word/token boundaries remain.
  if (
    /[0-9٠-٩۰-۹]\s*$/u.test(previousText) &&
    /^\s*[.,٫][0-9٠-٩۰-۹]{1,4}(?![0-9٠-٩۰-۹])/u.test(currentText)
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
        parserInput += parserBoundary(previous.text, text, boundaryBefore);
      }
      const combinedStart = input.length;
      const parserStart = parserInput.length;
      input += text;
      parserInput += text;
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
    const renderingAnchor = selectPriceAnchor([node], parserInput, match).anchor;
    if (!renderingAnchor) return [];
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
    /(?:IRT|IRR|TMN|Tomans?|Rials?|تومان|تومن|ریال)/iu.test(node.textContent ?? "")
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
    if (retainedDirect.length > 0) {
      results.push(...retainedDirect);
    } else {
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

  const accepted = results.filter((candidate, index, all) =>
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

function scannerExcludedVisualNodesUnder(root: Node): Text[] {
  const sourceAriaHiddenSelector = [
    '[aria-hidden="true"]',
    ':not([data-ehinium-badge="true"])',
    ':not([data-ehinium-converted="true"])',
    ':not([data-euc-owned="true"])',
    ':not([data-euc-badge="true"])',
  ].join("");
  if (root instanceof Text) {
    const ariaScope = root.parentElement?.closest('[aria-hidden="true"]');
    return ariaScope && !isInsideExcludedContent(ariaScope)
      ? textNodesUnder(ariaScope)
      : [];
  }
  const scopes: Element[] = [];
  if (root instanceof Element) {
    const containingAriaScope = root.closest(sourceAriaHiddenSelector);
    if (containingAriaScope) scopes.push(containingAriaScope);
  }
  if (root instanceof Element && root.matches(sourceAriaHiddenSelector)) scopes.push(root);
  if ("querySelectorAll" in root) {
    scopes.push(...(root as ParentNode).querySelectorAll(sourceAriaHiddenSelector));
  }
  return [...new Set(
    scopes
      .filter((scope) => !isInsideExcludedContent(scope))
      .flatMap(textNodesUnder)
  )];
}

/** Shared visibility-aware DOM discovery used by production and diagnostics. */
export function discoverCurrencyMatchesInRoots(
  roots: readonly Node[],
  context: DomCurrencyDiscoveryContext = {}
): DomCurrencyDiscoveryResult {
  const allNodes = [...new Set([
    ...(context.candidateNodes ?? []),
    ...roots.flatMap(context.candidateNodes
      ? scannerExcludedVisualNodesUnder
      : textNodesUnder),
  ])].filter((node) => !!node.textContent?.trim() && !isInsideExcludedContent(node));
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
  const matches = collectCurrencyDomMatches(visibleNodes);
  return {
    matches,
    rejectedMatches,
    fragments: matches.flatMap((match) => match.fragmentMap),
  };
}

export function discoverCurrencyMatchesInElement(
  element: Element,
  context: DomCurrencyDiscoveryContext = {}
): DomCurrencyDiscoveryResult {
  return discoverCurrencyMatchesInRoots([element], context);
}
