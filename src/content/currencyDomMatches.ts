import { parseCurrencies, type CurrencyMatch } from "../utils/currencyParser";
import { getContentExclusionDetail, isInsideExcludedContent } from "./domExclusions";
import { selectPriceAnchor } from "./priceAnchor";

export type TextFragmentMap = {
  node: Text;
  combinedStart: number;
  combinedEnd: number;
};

export type CurrencyDomMatch = {
  parserInput: string;
  match: CurrencyMatch;
  fragmentMap: TextFragmentMap[];
  sourceNodes: Text[];
  sourceElement: HTMLElement;
  renderingAnchor: HTMLElement;
  scanKind: "direct" | "combined-inline";
  directNodeParserSucceeded: boolean;
  localCombinedScanAttempted: boolean;
  excludedExtensionFragmentCount: number;
  combinedTextContainsExtensionUi: false;
};

export type SourceTextFragmentCollection = {
  input: string;
  fragments: TextFragmentMap[];
  excludedExtensionFragmentCount: number;
  combinedTextContainsExtensionUi: false;
};

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

function hasNestedBlockBoundary(container: HTMLElement): boolean {
  for (const child of container.querySelectorAll<HTMLElement>("*")) {
    if (BLOCK_TAGS.has(child.tagName)) {
      return true;
    }
  }
  return false;
}

export function collectSourceTextFragments(
  container: HTMLElement,
  eligibleNodes?: ReadonlySet<Text>
): SourceTextFragmentCollection {
  const fragments: TextFragmentMap[] = [];
  let input = "";
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
      const combinedStart = input.length;
      input += text;
      fragments.push({ node, combinedStart, combinedEnd: input.length });
    }

    current = walker.nextNode();
  }

  return {
    input,
    fragments,
    excludedExtensionFragmentCount,
    combinedTextContainsExtensionUi: false,
  };
}

function collectFragments(
  container: HTMLElement,
  eligibleNodes: ReadonlySet<Text>
): SourceTextFragmentCollection | null {
  if (container.matches(LOCAL_BOUNDARY_SELECTOR) || hasNestedBlockBoundary(container)) {
    return null;
  }

  const collection = collectSourceTextFragments(container, eligibleNodes);
  if (
    collection.fragments.length < 2 ||
    collection.fragments.length > MAX_LOCAL_FRAGMENTS ||
    collection.input.length > MAX_LOCAL_TEXT_LENGTH
  ) {
    return null;
  }

  return collection;
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

  return parseCurrencies(parserInput).flatMap((match) => {
    const renderingAnchor = selectPriceAnchor([node], parserInput, match).anchor;
    if (!renderingAnchor) return [];
    return [{
    parserInput,
    match,
    fragmentMap: [{ node, combinedStart: 0, combinedEnd: parserInput.length }],
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

export function collectCurrencyDomMatches(
  textNodes: readonly Text[]
): CurrencyDomMatch[] {
  const uniqueTextNodes = [...new Set(textNodes)];
  const results: CurrencyDomMatch[] = [];
  const nodesWithoutDirectMatches: Text[] = [];
  const parsedContainers = new Set<HTMLElement>();

  for (const node of uniqueTextNodes) {
    const direct = directDomMatches(node);
    if (direct.length > 0) {
      results.push(...direct);
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
        const matches = parseCurrencies(local.input);

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

      if (BLOCK_TAGS.has(container.tagName)) {
        break;
      }
      container = container.parentElement;
    }
  }

  return results;
}
