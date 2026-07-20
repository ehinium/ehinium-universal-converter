/**
 * Compatibility hooks retained for callers that coordinate badge cleanup with
 * source mutations. Stable badges remain in document flow; no viewport overlay
 * registry or scroll-managed positioning exists.
 */
export function markBadgeRemovalIntentional(_root: Node): void {
  // Natural-flow badges are removed directly by their owning renderer/registry.
}

export function handleBadgeLifecycleMutations(_mutations: readonly MutationRecord[]): void {
  // Source mutation batches are reconciled by the normal conversion scan.
}

export function clearBadgeLifecycles(_root: ParentNode = document): void {
  // There is no independent badge lifecycle registry to clear.
}
