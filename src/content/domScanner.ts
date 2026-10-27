import {
  getContentExclusionDetail,
} from "./domExclusions";

/**
 * Screen-reader-only copies by their conventional class names. Sites pair
 * them with the visible text (often marked aria-hidden), so scanning both
 * would convert one price twice and anchor a badge to invisible text.
 * aria-hidden itself is not a visibility signal and is scanned normally.
 * "offscreen" counts only at the end of a class ("a-offscreen", "aok-offscreen"),
 * not in "offscreen-cart"; Tailwind's "md:not-sr-only" shows the text. Copies
 * hidden by other names are found by their computed style. This selector runs
 * in `closest()` for every text node: plain, case-sensitive substrings keep it fast.
 */
export const SCREEN_READER_ONLY_SELECTOR = [
  '[class$="offscreen"]',
  '[class*="offscreen "]',
  '[class*="sr-only"]:not([class*="not-sr-only"])',
  '[class*="sr_only"]',
  ".sr_true",
  '[class*="sr-text"]',
  '[class*="visually-hidden"]',
  '[class*="visuallyhidden"]',
  '[class*="screen-reader"]',
  '[class*="screenreader"]',
  '[class*="a11y-hidden"]',
  '[class*="assistive-text"]',
].join(", ");

const HIDDEN_ROOT_SELECTORS = [
  SCREEN_READER_ONLY_SELECTOR,
  '[data-ehinium-ignore="true"]',
  '[data-ehinium-badge="true"]',
  '[data-ehinium-converted="true"]',
  '[data-euc-owned="true"]',
  '[data-euc-badge="true"]',
  "[data-ehinium-tooltip]",
];
const EXCLUDED_TEXT_NODE_SELECTORS = HIDDEN_ROOT_SELECTORS;
const HIDDEN_ROOT_SELECTOR = HIDDEN_ROOT_SELECTORS.join(", ");

export type TextNodeScanOptions = {
  maxNodes?: number;
};

export type TextNodeScanExclusion = {
  reason: string;
  rule: string;
  element: Element | null;
  category: "extension-ui" | "source-content";
};

export function getTextNodeScanExclusion(node: Text): TextNodeScanExclusion | null {
  const parent = node.parentElement;

  if (!parent) {
    return {
      reason: "Text node has no parent element",
      rule: "missing-parent",
      element: null,
      category: "source-content",
    };
  }

  const contentDetail = getContentExclusionDetail(parent);
  if (contentDetail) {
    return contentDetail;
  }

  for (const selector of EXCLUDED_TEXT_NODE_SELECTORS) {
    const excludedAncestor = parent.closest(selector);
    if (excludedAncestor) {
      return {
        reason: `Matched scanner exclusion selector ${selector} on <${excludedAncestor.tagName.toLowerCase()}>`,
        rule: selector,
        element: excludedAncestor,
        category: /(?:ehinium|data-euc)/iu.test(selector) ? "extension-ui" : "source-content",
      };
    }
  }

  if (!node.textContent?.trim()) {
    return {
      reason: "Text node is empty or whitespace-only",
      rule: "empty-text",
      element: parent,
      category: "source-content",
    };
  }

  return null;
}

export function getTextNodeScanExclusionReason(node: Text): string | null {
  return getTextNodeScanExclusion(node)?.reason ?? null;
}

export function isHiddenOrDisconnectedRoot(root: Node): boolean {
  if (!root.isConnected) {
    return true;
  }

  if (!(root instanceof Element)) {
    return false;
  }

  return (
    root.closest(HIDDEN_ROOT_SELECTOR) !== null ||
    root.closest("[hidden]") !== null ||
    root.closest('[style*="display: none"]') !== null ||
    root.closest('[style*="display:none"]') !== null
  );
}

export function getTextNodes(
  root: Node,
  options: TextNodeScanOptions = {}
): Text[] {
  const textNodes: Text[] = [];
  const ownerDocument = root.ownerDocument ?? document;

  if (root instanceof Text) {
    const parent = root.parentElement;

    if (
      parent &&
      getTextNodeScanExclusionReason(root) === null
    ) {
      return [root];
    }

    return [];
  }

  const walker = ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;

        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }

        if (getTextNodeScanExclusionReason(node as Text) !== null) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let currentNode = walker.nextNode();

  while (currentNode) {
    textNodes.push(currentNode as Text);

    if (
      options.maxNodes !== undefined &&
      textNodes.length >= options.maxNodes
    ) {
      break;
    }

    currentNode = walker.nextNode();
  }

  return textNodes;
}
