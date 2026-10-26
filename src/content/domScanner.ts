import {
  getContentExclusionDetail,
} from "./domExclusions";

const ARIA_HIDDEN_SELECTOR = '[aria-hidden="true"]';
const HIDDEN_ROOT_SELECTORS = [
  ".a-offscreen",
  '[data-ehinium-ignore="true"]',
  '[data-ehinium-badge="true"]',
  '[data-ehinium-converted="true"]',
  '[data-euc-owned="true"]',
  '[data-euc-badge="true"]',
  "[data-ehinium-tooltip]",
];
const EXCLUDED_TEXT_NODE_SELECTORS = [...HIDDEN_ROOT_SELECTORS, ARIA_HIDDEN_SELECTOR];

// aria-hidden only removes content from the accessibility tree; it is not a
// visibility signal. Roots inside it still reach currency discovery, which
// applies its own visual checks to aria-hidden fragments.
const HIDDEN_ROOT_SELECTOR = HIDDEN_ROOT_SELECTORS.join(", ");

const controlLabelCache = new WeakMap<Element, boolean>();

/**
 * Amazon renders swatch and size button text inside an aria-hidden span that
 * the button's input names through aria-labelledby. That span is the visible
 * label of the control, not a decorative duplicate.
 */
function isVisibleControlLabel(element: Element): boolean {
  const cached = controlLabelCache.get(element);
  if (cached !== undefined) {
    return cached;
  }

  const id = element.id.replace(/["\\]/gu, "\\$&");
  const isLabel = id !== "" &&
    element.ownerDocument.querySelector(`[aria-labelledby~="${id}"]`) !== null;
  controlLabelCache.set(element, isLabel);
  return isLabel;
}

function closestExcludedAriaHidden(element: Element): Element | null {
  let current = element.closest(ARIA_HIDDEN_SELECTOR);
  while (current && isVisibleControlLabel(current)) {
    current = current.parentElement?.closest(ARIA_HIDDEN_SELECTOR) ?? null;
  }
  return current;
}

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
    const excludedAncestor = selector === ARIA_HIDDEN_SELECTOR
      ? closestExcludedAriaHidden(parent)
      : parent.closest(selector);
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
