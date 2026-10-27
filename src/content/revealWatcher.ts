/**
 * Prices and measurements in hidden content (a closed tab, another variant's
 * price block, a sticky bar faded to opacity 0) get no badge: there is nowhere
 * visible to put it. Sites reveal such content by toggling a class or style,
 * which the content observer does not follow (it watches text and nodes, not
 * attributes). Elements skipped while hidden are remembered here; while any
 * are, an attribute observer rescans the ones that become visible.
 */

const MAX_WATCHED_ELEMENTS = 200;
// The second look catches reveals that fade in through a CSS transition.
const RECHECK_DELAYS_MS = [120, 650];
const REVEAL_ATTRIBUTES = ["class", "style", "hidden", "open"];

const watched = new Set<Element>();
const touched = new Set<Element>();
let attributeObserver: MutationObserver | null = null;
let onReveal: ((roots: Element[]) => void) | null = null;
let recheckTimers: number[] = [];

function isShown(element: Element): boolean {
  if (!element.isConnected) return false;
  if (typeof element.checkVisibility === "function" &&
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function stopObservingAttributes(): void {
  attributeObserver?.disconnect();
  attributeObserver = null;
  for (const timer of recheckTimers) window.clearTimeout(timer);
  recheckTimers = [];
  touched.clear();
}

function checkTouched(final: boolean): void {
  const revealed: Element[] = [];
  for (const element of touched) {
    if (!watched.has(element) || !element.isConnected) {
      watched.delete(element);
      touched.delete(element);
    } else if (isShown(element)) {
      watched.delete(element);
      touched.delete(element);
      revealed.push(element);
    }
  }
  if (final) touched.clear();
  if (watched.size === 0) stopObservingAttributes();
  if (revealed.length > 0) onReveal?.(revealed);
}

function handleAttributeMutations(mutations: readonly MutationRecord[]): void {
  const targets = new Set<Element>();
  for (const mutation of mutations) {
    if (mutation.target instanceof Element) targets.add(mutation.target);
  }
  for (const element of watched) {
    if (!element.isConnected) {
      watched.delete(element);
      continue;
    }
    for (const target of targets) {
      if (target === element || target.contains(element)) {
        touched.add(element);
        break;
      }
    }
  }
  if (watched.size === 0) {
    stopObservingAttributes();
    return;
  }
  if (touched.size === 0 || recheckTimers.length > 0) return;
  recheckTimers = RECHECK_DELAYS_MS.map((delay, index) => window.setTimeout(() => {
    const final = index === RECHECK_DELAYS_MS.length - 1;
    if (final) recheckTimers = [];
    checkTouched(final);
  }, delay));
}

/** Remembers hidden content that held a price or a measurement. */
export function rememberHiddenContent(element: Element | null | undefined): void {
  if (!onReveal || !element || watched.has(element)) return;
  if (watched.size >= MAX_WATCHED_ELEMENTS) {
    const oldest = watched.values().next().value;
    if (oldest) watched.delete(oldest);
  }
  watched.add(element);
  if (attributeObserver) return;
  attributeObserver = new MutationObserver(handleAttributeMutations);
  attributeObserver.observe(document, {
    attributes: true,
    attributeFilter: REVEAL_ATTRIBUTES,
    subtree: true,
  });
}

export function startRevealWatcher(callback: (roots: Element[]) => void): () => void {
  onReveal = callback;
  return () => {
    onReveal = null;
    watched.clear();
    stopObservingAttributes();
  };
}
