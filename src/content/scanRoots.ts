import { getTextNodes, isHiddenOrDisconnectedRoot } from "./domScanner";

const MAX_TEXT_NODES_PER_SCAN = 2500;
const ROOT_BATCH_SIZE = 10;
const SHADOW_ROOT_BATCH_SIZE = 100;

function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 50 });
      return;
    }

    setTimeout(resolve, 0);
  });
}

function dedupeRoots(roots: readonly Node[]): Node[] {
  // Nodes in different trees (the document, each shadow root) never contain
  // each other, so roots are only compared within their own tree.
  const rootsByTree = new Map<Node, Node[]>();

  for (const root of roots) {
    const tree = root.getRootNode();
    let uniqueRoots = rootsByTree.get(tree);
    if (!uniqueRoots) rootsByTree.set(tree, uniqueRoots = []);

    if (uniqueRoots.some((existingRoot) => existingRoot === root || existingRoot.contains(root))) {
      continue;
    }

    for (let index = uniqueRoots.length - 1; index >= 0; index--) {
      if (root.contains(uniqueRoots[index])) uniqueRoots.splice(index, 1);
    }

    uniqueRoots.push(root);
  }

  return [...rootsByTree.values()].flat().filter((root) => !isHiddenOrDisconnectedRoot(root));
}

export async function collectTextNodesForScan(
  roots: readonly Node[]
): Promise<Text[]> {
  const textNodes: Text[] = [];
  // Shadow roots (one per web component, many and small) come after the page's
  // roots; a budget of their own keeps a text-heavy page from starving them.
  const collected = { page: 0, shadow: 0 };
  const visited = { page: 0, shadow: 0 };

  for (const root of dedupeRoots(roots)) {
    const kind = root.nodeType === 11 ? "shadow" : "page";
    const remaining = MAX_TEXT_NODES_PER_SCAN - collected[kind];

    if (remaining <= 0) {
      continue;
    }

    const nodes = getTextNodes(root, { maxNodes: remaining });
    collected[kind] += nodes.length;
    textNodes.push(...nodes);

    if (++visited[kind] % (kind === "shadow" ? SHADOW_ROOT_BATCH_SIZE : ROOT_BATCH_SIZE) === 0) {
      await waitForIdle();
    }
  }

  return textNodes;
}
