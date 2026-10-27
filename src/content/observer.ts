import { isInsideExcludedContent } from "./domExclusions";
import { isHiddenOrDisconnectedRoot } from "./domScanner";
import { isProcessed } from "./processedNodes";
import { releaseProcessedSourceTree } from "./currencyMatchState";
import type { MutationBatchDiagnostic } from "../types/diagnostics";
import { consumeExtensionMove, handleBadgeLifecycleMutations, wasBadgeRemovedIntentionally } from "./badgeLifecycle";
import { handleBadgeHostMutations } from "./badgeHost";
import { reconcileAffectedBadgeHosts } from "./badgeHostRegistry";
import { recordMutationBatch } from "./perfDiagnostics";

const EUC_OWNED_SELECTOR = [
  '[data-ehinium-badge="true"]',
  "[data-ehinium-tooltip]",
  "[data-ehinium-converted]",
  '[data-ehinium-ignore="true"]',
  '[data-euc-owned="true"]',
  '[data-euc-badge="true"]',
].join(", ");

const BADGE_SELECTOR = '[data-ehinium-badge="true"]';
let stopActiveObserver: (() => void) | null = null;
let nextMutationBatchId = 1;
const mutationDiagnostics: MutationBatchDiagnostic[] = [];
const MAX_MUTATION_DIAGNOSTICS = 100;

function diagnosticsEnabled(): boolean {
  return typeof __EUC_DIAGNOSTICS__ !== "undefined" && __EUC_DIAGNOSTICS__;
}

function describeMutationScope(node: Node): string {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) {
    return "(detached)";
  }
  return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`;
}

export function getMutationBatchDiagnostics(): MutationBatchDiagnostic[] {
  return mutationDiagnostics.map((batch) => ({
    ...batch,
    affectedSourceScopes: [...batch.affectedSourceScopes],
    preReconciliationSourceMatches: [...batch.preReconciliationSourceMatches],
    warnings: [...batch.warnings],
  }));
}

export function clearMutationBatchDiagnostics(): void {
  mutationDiagnostics.length = 0;
}

export function finalizePendingMutationDiagnostics(counters: {
  adoptedBadgeCount: number;
  updatedBadgeCount: number;
  removedStaleBadgeCount: number;
  newlyRenderedBadgeCount: number;
}): void {
  const batch = [...mutationDiagnostics].reverse().find(
    (item) => item.finalActiveBadgeCount === undefined && item.mutationCategory !== "extension-ui"
  );
  if (!batch) {
    return;
  }
  Object.assign(batch, counters);
  batch.finalActiveBadgeCount = document.querySelectorAll(
    '[data-ehinium-badge="true"][data-ehinium-source-fingerprint]'
  ).length;
  const activeFingerprints = new Map<string, number>();
  for (const badge of document.querySelectorAll<HTMLElement>(
    '[data-ehinium-badge="true"][data-ehinium-source-fingerprint]'
  )) {
    const fingerprint = badge.dataset.ehiniumSourceFingerprint;
    if (fingerprint) {
      activeFingerprints.set(fingerprint, (activeFingerprints.get(fingerprint) ?? 0) + 1);
    }
  }
  for (const [fingerprint, count] of activeFingerprints) {
    if (count > 1) {
      batch.warnings.push(`Source fingerprint ${fingerprint} has ${count} active badges`);
    }
  }
}

function isEucOwnedNode(node: Node): boolean {
  if (node instanceof Element) {
    return node.matches(EUC_OWNED_SELECTOR) || node.closest(EUC_OWNED_SELECTOR) !== null;
  }

  return node.parentElement?.closest(EUC_OWNED_SELECTOR) !== null;
}

export function isExtensionOwnedMutation(mutation: MutationRecord): boolean {
  if (isEucOwnedNode(mutation.target)) return true;
  const affected = [
    ...mutation.addedNodes,
    ...mutation.removedNodes,
  ];

  if (mutation.type === "characterData") {
    return isEucOwnedNode(mutation.target);
  }

  return affected.length > 0 && affected.every(isEucOwnedNode);
}

export function classifyMutationBatch(
  mutations: readonly MutationRecord[]
): "site-content" | "extension-ui" | "mixed" {
  const extensionCount = mutations.filter(isExtensionOwnedMutation).length;
  if (extensionCount === mutations.length) {
    return "extension-ui";
  }
  return extensionCount === 0 ? "site-content" : "mixed";
}

// One record can insert many nodes at once (`append(...cards)`, `innerHTML`, a
// fragment); each is a root. Past a few dozen, their parent is one cheaper root.
const MAX_ADDED_ROOTS_PER_MUTATION = 32;
// A page that strips a badge (React hydration, a re-render) gets it back, but
// only a few times: a page that keeps removing foreign nodes is not fought.
const RESTORE_WINDOW_MS = 30_000;
const MAX_RESTORES_PER_WINDOW = 3;
const restoreHistory = new WeakMap<Node, number[]>();

function removedBadgeByPage(mutation: MutationRecord): boolean {
  return [...mutation.removedNodes].some((node) =>
    node instanceof Element && node.matches(BADGE_SELECTOR) && !node.isConnected &&
    !wasBadgeRemovedIntentionally(node));
}

function restoreAllowed(target: Node): boolean {
  if (!(target instanceof Element) || !isRelevantNode(target)) return false;
  const now = Date.now();
  const recent = (restoreHistory.get(target) ?? []).filter((time) => now - time < RESTORE_WINDOW_MS);
  if (recent.length >= MAX_RESTORES_PER_WINDOW) return false;
  recent.push(now);
  restoreHistory.set(target, recent);
  return true;
}

function getMutationRoots(mutation: MutationRecord): Node[] {
  if (isEucOwnedNode(mutation.target) || isInsideExcludedContent(mutation.target)) {
    return [];
  }

  if (mutation.type === "characterData") {
    const parent = mutation.target.parentElement;
    return parent ? [parent] : [];
  }

  for (const node of mutation.removedNodes) {
    // A price moved into a badge group stays on the page.
    if (!isEucOwnedNode(node) && !consumeExtensionMove(node)) {
      releaseProcessedSourceTree(node);
    }
  }

  if (removedBadgeByPage(mutation) && restoreAllowed(mutation.target)) {
    return [mutation.target];
  }
  // A price put back from a badge group is not new content.
  const added = [...mutation.addedNodes].filter((node) => !consumeExtensionMove(node) && isRelevantNode(node));
  if (added.length > MAX_ADDED_ROOTS_PER_MUTATION && isRelevantNode(mutation.target)) {
    return [mutation.target];
  }
  return added;
}

function isRelevantNode(node: Node): boolean {
  return (
    !isEucOwnedNode(node) &&
    !isInsideExcludedContent(node) &&
    !isHiddenOrDisconnectedRoot(node) &&
    !(node instanceof Text && isProcessed(node))
  );
}

export function collectMutationRoots(mutations: readonly MutationRecord[]): Node[] {
  const roots: Node[] = [];

  for (const mutation of mutations) {
    for (const root of getMutationRoots(mutation)) {
      if (roots.some((existing) => existing === root || existing.contains(root))) continue;
      for (let index = roots.length - 1; index >= 0; index--) {
        if (root.contains(roots[index])) roots.splice(index, 1);
      }
      roots.push(root);
    }
  }

  return roots;
}

export function observeDomChanges(callback: (roots: Node[]) => void): () => void {
  stopActiveObserver?.();

  let stopped = false;

  const observer = new MutationObserver((mutations) => {
    const perfDiagnosticsEnabled = typeof __EUC_PERF_DIAGNOSTICS__ !== "undefined" && __EUC_PERF_DIAGNOSTICS__;
    const perfStartedAt = perfDiagnosticsEnabled ? performance.now() : 0;
    if (stopped) {
      return;
    }

    handleBadgeHostMutations(mutations);
    handleBadgeLifecycleMutations(mutations);
    reconcileAffectedBadgeHosts(mutations);
    const roots = collectMutationRoots(mutations);

    if (perfDiagnosticsEnabled) {
      recordMutationBatch(mutations, roots, performance.now() - perfStartedAt);
    }

    if (diagnosticsEnabled()) {
      const category = classifyMutationBatch(mutations);
      const existingBadges = [...document.querySelectorAll<HTMLElement>(
        '[data-ehinium-badge="true"][data-ehinium-source-fingerprint]'
      )];
      mutationDiagnostics.push({
        batchId: `mutation-${nextMutationBatchId++}`,
        timestamp: new Date().toISOString(),
        mutationCategory: category,
        mutationCount: mutations.length,
        addedSourceNodeCount: mutations.reduce(
          (count, mutation) => count + [...mutation.addedNodes].filter((node) => !isEucOwnedNode(node)).length,
          0
        ),
        removedSourceNodeCount: mutations.reduce(
          (count, mutation) => count + [...mutation.removedNodes].filter((node) => !isEucOwnedNode(node)).length,
          0
        ),
        extensionOwnedMutationCount: mutations.filter(isExtensionOwnedMutation).length,
        affectedSourceScopes: [...new Set(roots.map(describeMutationScope))],
        preReconciliationSourceMatches: existingBadges
          .map((badge) => badge.dataset.ehiniumSourceFingerprint)
          .filter((value): value is string => Boolean(value)),
        existingOwnedBadgeCount: existingBadges.length,
        adoptedBadgeCount: 0,
        updatedBadgeCount: 0,
        removedStaleBadgeCount: 0,
        newlyRenderedBadgeCount: 0,
        finalActiveBadgeCount: category === "extension-ui"
          ? existingBadges.length
          : undefined,
        warnings: category === "extension-ui"
          ? ["Extension-owned mutation ignored"]
          : [],
      });
      if (mutationDiagnostics.length > MAX_MUTATION_DIAGNOSTICS) {
        mutationDiagnostics.splice(0, mutationDiagnostics.length - MAX_MUTATION_DIAGNOSTICS);
      }
    }

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
