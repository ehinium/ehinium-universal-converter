import { isInsideExcludedContent } from "./domExclusions";

const EXCLUDED_TEXT_NODE_SELECTOR = [
  ".a-price",
  ".a-offscreen",
  '[aria-hidden="true"]',
  "[data-ehinium-price-key]",
  '[data-ehinium-ignore="true"]',
  '[data-ehinium-badge="true"]',
  '[data-ehinium-converted="true"]',
  "[data-ehinium-tooltip]",
].join(", ");

export type TextNodeScanOptions = {
  maxNodes?: number;
};

export function isHiddenOrDisconnectedRoot(root: Node): boolean {
  if (!root.isConnected) {
    return true;
  }

  if (!(root instanceof Element)) {
    return false;
  }

  return (
    root.closest(EXCLUDED_TEXT_NODE_SELECTOR) !== null ||
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
      !isInsideExcludedContent(parent) &&
      !parent.closest(EXCLUDED_TEXT_NODE_SELECTOR) &&
      root.textContent?.trim()
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

        if (
          isInsideExcludedContent(parent) ||
          parent.closest(EXCLUDED_TEXT_NODE_SELECTOR)
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!node.textContent?.trim()) {
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
