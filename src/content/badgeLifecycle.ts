/**
 * Badges this extension removes on purpose (re-render, duplicate cleanup, a
 * placement that did not fit). Any other removal of a badge was the page's own
 * (React hydration, a framework re-render), and the observer restores it.
 * Stable badges remain in document flow; no viewport overlay registry exists.
 */
const BADGE_SELECTOR = '[data-ehinium-badge="true"]';
const intentionallyRemoved = new WeakSet<Node>();

export function markBadgeRemovalIntentional(root: Node): void {
  intentionallyRemoved.add(root);
  if ("querySelectorAll" in root && typeof root.querySelectorAll === "function") {
    for (const badge of (root as ParentNode).querySelectorAll(BADGE_SELECTOR)) intentionallyRemoved.add(badge);
  }
}

export function wasBadgeRemovedIntentionally(node: Node): boolean {
  return intentionallyRemoved.has(node);
}

/**
 * Page nodes this extension moves itself: a price wrapped into a badge group,
 * and put back when its badge goes. The observer must not read the move as
 * page content leaving or arriving; otherwise a badge that does not fit is
 * rescanned, inserted and removed again without end. Each move reaches the
 * observer as one record (wrapping and unwrapping in one task are two); marks
 * older than the window were never observed and say nothing about later moves.
 */
const extensionMoves = new WeakMap<Node, { pending: number; movedAt: number }>();
const EXTENSION_MOVE_WINDOW_MS = 5_000;

export function markMovedByExtension(node: Node): void {
  const now = Date.now();
  const move = extensionMoves.get(node);
  const pending = move && now - move.movedAt < EXTENSION_MOVE_WINDOW_MS ? move.pending : 0;
  extensionMoves.set(node, { pending: pending + 1, movedAt: now });
}

/** True for the record of a move this extension made; each move is consumed once. */
export function consumeExtensionMove(node: Node): boolean {
  const move = extensionMoves.get(node);
  if (!move) return false;
  if (Date.now() - move.movedAt >= EXTENSION_MOVE_WINDOW_MS) {
    extensionMoves.delete(node);
    return false;
  }
  if (move.pending <= 1) extensionMoves.delete(node);
  else move.pending--;
  return true;
}

export function handleBadgeLifecycleMutations(_mutations: readonly MutationRecord[]): void {
  // Source mutation batches are reconciled by the normal conversion scan.
}

export function clearBadgeLifecycles(_root: ParentNode = document): void {
  // There is no independent badge lifecycle registry to clear.
}
