import { isInsideExcludedContent } from "./domExclusions";

const EXCLUDED_TEXT_NODE_SELECTOR = [
  ".a-price",
  ".a-offscreen",
  '[aria-hidden="true"]',
  "[data-ehinium-price-key]",
  '[data-ehinium-ignore="true"]',
  '[data-ehinium-badge="true"]',
  '[data-ehinium-converted="true"]',
].join(", ");

export function getTextNodes(root: Node): Text[] {
  const textNodes: Text[] = [];
  const ownerDocument = root.ownerDocument ?? document;

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
    currentNode = walker.nextNode();
  }

  return textNodes;
}
