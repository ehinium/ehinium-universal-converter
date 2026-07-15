import { parseCurrencies } from "../utils/currencyParser";
import {
  collectSourceTextFragments,
  type CurrencyDomMatch,
} from "./currencyDomMatches";

type ProcessedMatchRecord = {
  inputVersion: string;
  badge: HTMLElement;
};

export type ReconciliationDecisionType =
  | "render-new"
  | "skip-exact-node-duplicate"
  | "skip-anchor-owned-duplicate"
  | "adopt-existing-badge"
  | "transfer-ownership-after-replacement"
  | "remove-stale-and-render"
  | "update-existing-badge"
  | "render-distinct-occurrence";

export type DuplicateDecision = {
  duplicate: boolean;
  processedMatchKey: string;
  sourceFingerprint: string;
  scopeFingerprint: string;
  ownerPositionKey: string;
  decision: ReconciliationDecisionType;
  reason?: string;
  previousOwner?: string;
  badgeConnected?: boolean;
};

const processedMatches = new WeakMap<Text, Map<string, ProcessedMatchRecord>>();
const scopeIds = new WeakMap<Element, string>();
let nextScopeId = 1;
const reconciliationCounters = {
  adoptedBadgeCount: 0,
  updatedBadgeCount: 0,
  removedStaleBadgeCount: 0,
  newlyRenderedBadgeCount: 0,
};

export function consumeReconciliationCounters(): typeof reconciliationCounters {
  const snapshot = { ...reconciliationCounters };
  reconciliationCounters.adoptedBadgeCount = 0;
  reconciliationCounters.updatedBadgeCount = 0;
  reconciliationCounters.removedStaleBadgeCount = 0;
  reconciliationCounters.newlyRenderedBadgeCount = 0;
  return snapshot;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeSourceText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function getPrimaryNode(candidate: CurrencyDomMatch): Text {
  return candidate.sourceNodes[0];
}

function getReconciliationScope(candidate: CurrencyDomMatch): HTMLElement {
  const anchor = candidate.renderingAnchor;
  const parent = anchor.parentElement;

  if (parent?.matches('[data-ehinium-price-group="true"]')) {
    return parent.parentElement ?? parent;
  }

  return parent ?? anchor;
}

function getScopeId(scope: Element): string {
  const existing = scopeIds.get(scope);
  if (existing) {
    return existing;
  }

  const id = `scope-${nextScopeId++}`;
  scopeIds.set(scope, id);
  return id;
}

function isExtensionUiElement(element: Element): boolean {
  return element.matches([
    '[data-ehinium-badge="true"]',
    '[data-ehinium-converted="true"]',
    "[data-ehinium-tooltip]",
  ].join(", "));
}

function getLocalElementPath(element: Element, scope: Element): string {
  const parts: number[] = [];
  let current: Element | null = element;

  while (current && current !== scope && parts.length < 4) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      break;
    }
    if (parent.matches('[data-ehinium-price-group="true"]')) {
      current = parent;
      continue;
    }
    const sourceChildren = [...parent.children].filter(
      (child) => !isExtensionUiElement(child)
    );
    parts.push(Math.max(0, sourceChildren.indexOf(current)));
    current = parent;
  }

  return parts.reverse().join(".") || "self";
}

function getOccurrenceIndex(candidate: CurrencyDomMatch): number {
  const matches = parseCurrencies(candidate.parserInput);
  const index = matches.findIndex(
    (match) =>
      match.start === candidate.match.start &&
      match.end === candidate.match.end &&
      match.currency === candidate.match.currency &&
      match.amount === candidate.match.amount
  );
  return Math.max(0, index);
}

function getOwnership(candidate: CurrencyDomMatch, targetCurrency: string) {
  const scope = getReconciliationScope(candidate);
  const sourceCollection = collectSourceTextFragments(scope);
  const scopeFingerprint = hashText(
    `${scope.tagName}|${normalizeSourceText(sourceCollection.input)}`
  );
  const ownerPositionKey = hashText([
    getScopeId(scope),
    getLocalElementPath(candidate.renderingAnchor, scope),
    getOccurrenceIndex(candidate),
    targetCurrency,
  ].join("|"));
  const sourceFingerprint = hashText([
    ownerPositionKey,
    candidate.match.currency,
    candidate.match.amount,
    targetCurrency,
    normalizeSourceText(candidate.match.raw),
  ].join("|"));

  return {
    scope,
    scopeFingerprint,
    ownerPositionKey,
    sourceFingerprint,
  };
}

export function getProcessedMatchKey(
  candidate: CurrencyDomMatch,
  targetCurrency: string
): string {
  const { match } = candidate;
  return [
    hashText(candidate.parserInput),
    match.start,
    match.end,
    match.amount,
    match.currency,
    targetCurrency,
  ].join("|");
}

function removeStaleRecords(primaryNode: Text, inputVersion: string): void {
  const records = processedMatches.get(primaryNode);
  if (!records) {
    return;
  }

  for (const [key, record] of records) {
    if (record.inputVersion !== inputVersion) {
      record.badge.remove();
      records.delete(key);
    } else if (!record.badge.isConnected) {
      records.delete(key);
    }
  }

  if (records.size === 0) {
    processedMatches.delete(primaryNode);
  }
}

function badgesInScope(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')];
}

function normalizeAmount(amount: number): string {
  return amount.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "");
}

function legacyBadgeKey(candidate: CurrencyDomMatch, targetCurrency: string): string {
  return `${normalizeAmount(candidate.match.amount)}|${candidate.match.currency}|${targetCurrency}`;
}

function applyOwnershipMetadata(
  badge: HTMLElement,
  candidate: CurrencyDomMatch,
  targetCurrency: string,
  decision: Pick<DuplicateDecision, "ownerPositionKey" | "sourceFingerprint" | "scopeFingerprint">
): void {
  badge.setAttribute("data-ehinium-owner-id", `${decision.ownerPositionKey}:${decision.sourceFingerprint}`);
  badge.setAttribute("data-ehinium-owner-position", decision.ownerPositionKey);
  badge.setAttribute("data-ehinium-source-fingerprint", decision.sourceFingerprint);
  badge.setAttribute("data-ehinium-scope-fingerprint", decision.scopeFingerprint);
  badge.setAttribute("data-ehinium-source-currency", candidate.match.currency);
  badge.setAttribute("data-ehinium-source-amount", String(candidate.match.amount));
  badge.setAttribute("data-ehinium-target-currency", targetCurrency);
}

export function getDuplicateDecision(
  candidate: CurrencyDomMatch,
  targetCurrency: string
): DuplicateDecision {
  const primaryNode = getPrimaryNode(candidate);
  const inputVersion = hashText(candidate.parserInput);
  const processedMatchKey = getProcessedMatchKey(candidate, targetCurrency);
  const ownership = getOwnership(candidate, targetCurrency);
  removeStaleRecords(primaryNode, inputVersion);
  const exactRecord = processedMatches.get(primaryNode)?.get(processedMatchKey);
  const base = {
    processedMatchKey,
    sourceFingerprint: ownership.sourceFingerprint,
    scopeFingerprint: ownership.scopeFingerprint,
    ownerPositionKey: ownership.ownerPositionKey,
  };

  if (exactRecord?.badge.isConnected) {
    return {
      ...base,
      duplicate: true,
      decision: "skip-exact-node-duplicate",
      reason: "Exact source node, text version, range, amount, currency, and target already owns a connected badge",
      badgeConnected: true,
    };
  }

  const scopeBadges = badgesInScope(ownership.scope);
  const equivalent = scopeBadges.filter(
    (badge) =>
      badge.dataset.ehiniumSourceFingerprint === ownership.sourceFingerprint ||
      (!badge.dataset.ehiniumSourceFingerprint &&
        badge.getAttribute("data-ehinium-key") === legacyBadgeKey(candidate, targetCurrency))
  );

  if (equivalent.length > 0) {
    const badge = equivalent[0];
    for (const duplicate of equivalent.slice(1)) {
      duplicate.remove();
      reconciliationCounters.removedStaleBadgeCount++;
    }
    applyOwnershipMetadata(badge, candidate, targetCurrency, base);
    badge.setAttribute("data-ehinium-source-match", processedMatchKey);
    const records = processedMatches.get(primaryNode) ?? new Map();
    records.set(processedMatchKey, { inputVersion, badge });
    processedMatches.set(primaryNode, records);
    reconciliationCounters.adoptedBadgeCount++;
    return {
      ...base,
      duplicate: true,
      decision: "transfer-ownership-after-replacement",
      reason: "An equivalent connected badge already owns this stable source fingerprint in the same local scope",
      previousOwner: badge.dataset.ehiniumOwnerId,
      badgeConnected: badge.isConnected,
    };
  }

  const staleAtPosition = scopeBadges.filter(
    (badge) => badge.dataset.ehiniumOwnerPosition === ownership.ownerPositionKey
  );
  for (const staleBadge of staleAtPosition) {
    staleBadge.remove();
    reconciliationCounters.removedStaleBadgeCount++;
  }

  return {
    ...base,
    duplicate: false,
    decision: staleAtPosition.length > 0
      ? "remove-stale-and-render"
      : "render-new",
    reason: staleAtPosition.length > 0
      ? "A connected badge at this source position represented stale source text and was removed"
      : undefined,
    badgeConnected: false,
  };
}

export function recordProcessedMatch(
  candidate: CurrencyDomMatch,
  targetCurrency: string,
  badge: HTMLElement,
  decision = getDuplicateDecision(candidate, targetCurrency)
): string {
  const primaryNode = getPrimaryNode(candidate);
  const inputVersion = hashText(candidate.parserInput);
  const key = getProcessedMatchKey(candidate, targetCurrency);
  const records = processedMatches.get(primaryNode) ?? new Map();
  records.set(key, { inputVersion, badge });
  processedMatches.set(primaryNode, records);
  reconciliationCounters.newlyRenderedBadgeCount++;
  badge.setAttribute("data-ehinium-source-match", key);
  applyOwnershipMetadata(badge, candidate, targetCurrency, decision);
  return key;
}

export function releaseProcessedSourceTree(root: Node): void {
  const nodes: Text[] = [];

  if (root instanceof Text) {
    nodes.push(root);
  } else {
    const walker = (root.ownerDocument ?? document).createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
  }

  for (const node of nodes) {
    const records = processedMatches.get(node);
    if (!records) {
      continue;
    }
    for (const record of records.values()) {
      record.badge.remove();
    }
    processedMatches.delete(node);
  }
}
