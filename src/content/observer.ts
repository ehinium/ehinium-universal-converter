import { isInsideExcludedContent } from "./domExclusions";
import { isHiddenOrDisconnectedRoot } from "./domScanner";
import { isProcessed } from "./processedNodes";

const EUC_OWNED_SELECTOR = [
  '[data-ehinium-badge="true"]',
  "[data-ehinium-tooltip]",
  "[data-ehinium-converted]",
  "[data-ehinium-price-key]",
  "[data-ehinium-price-group]",
  '[data-ehinium-ignore="true"]',
].join(", ");

let stopActiveObserver: (() => void) | null = null;

function isEucOwnedNode(node: Node): boolean {
  if (node instanceof Element) {
    return node.matches(EUC_OWNED_SELECTOR) || node.closest(EUC_OWNED_SELECTOR) !== null;
  }

  return node.parentElement?.closest(EUC_OWNED_SELECTOR) !== null;
}

function getMutationRoot(mutation: MutationRecord): Node | null {
  if (isEucOwnedNode(mutation.target) || isInsideExcludedContent(mutation.target)) {
    return null;
  }

  if (mutation.type === "characterData") {
    return mutation.target.parentElement;
  }

  for (const node of mutation.addedNodes) {
    if (isRelevantNode(node)) {
      return node;
    }
  }

  return null;
}

function isRelevantNode(node: Node): boolean {
  return (
    !isEucOwnedNode(node) &&
    !isInsideExcludedContent(node) &&
    !isHiddenOrDisconnectedRoot(node) &&
    !(node instanceof Text && isProcessed(node))
  );
}

function collectMutationRoots(mutations: readonly MutationRecord[]): Node[] {
  const roots: Node[] = [];

  for (const mutation of mutations) {
    const root = getMutationRoot(mutation);

    if (root && !roots.includes(root)) {
      roots.push(root);
    }
  }

  return roots;
}

export function observeDomChanges(callback: (roots: Node[]) => void): () => void {
  stopActiveObserver?.();

  let stopped = false;

  const observer = new MutationObserver((mutations) => {
    if (stopped) {
      return;
    }

    const roots = collectMutationRoots(mutations);

    if (roots.length === 0) {
      return;
    }

    callback(roots);
  });

  observer.observe(document, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  const stop = (): void => {
    if (stopped) {
      return;
    }

    stopped = true;
    observer.disconnect();

    if (stopActiveObserver === stop) {
      stopActiveObserver = null;
    }
  };

  stopActiveObserver = stop;
  return stop;
}
