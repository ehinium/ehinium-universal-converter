import { getTextNodes, isHiddenOrDisconnectedRoot } from "./domScanner";

const MAX_TEXT_NODES_PER_SCAN = 2500;
const ROOT_BATCH_SIZE = 10;

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
  const uniqueRoots: Node[] = [];

  for (const root of roots) {
    if (
      uniqueRoots.some(
        (existingRoot) =>
          existingRoot === root ||
          (existingRoot.contains(root) && existingRoot !== root)
      )
    ) {
      continue;
    }

    uniqueRoots.push(root);
  }

  return uniqueRoots.filter((root) => !isHiddenOrDisconnectedRoot(root));
}

export async function collectTextNodesForScan(
  roots: readonly Node[]
): Promise<Text[]> {
  const textNodes: Text[] = [];
  const dedupedRoots = dedupeRoots(roots);

  for (let index = 0; index < dedupedRoots.length; index++) {
    const remaining = MAX_TEXT_NODES_PER_SCAN - textNodes.length;

    if (remaining <= 0) {
      break;
    }

    textNodes.push(
      ...getTextNodes(dedupedRoots[index], { maxNodes: remaining })
    );

    if ((index + 1) % ROOT_BATCH_SIZE === 0) {
      await waitForIdle();
    }
  }

  return textNodes;
}
