import { parseCurrencies } from "../utils/currencyParser";
import {
  collectSourceTextFragments,
  type CurrencyDomMatch,
} from "./currencyDomMatches";
import { findExistingLineageBadges } from "./translationLineage";
import { markBadgeRemovalIntentional } from "./badgeLifecycle";

type ProcessedMatchRecord = {
  inputVersion: string;
  badge: HTMLElement;
  sourceNodes: readonly Text[];
  inputNodes: readonly Text[];
  anchor: HTMLElement;
  parserInput: string;
  start: number;
  end: number;
  sourceCurrency: string;
  amount: number;
  targetCurrency: string;
};

export type ReconciliationDiagnostic = {
  ownerRecordFound: boolean;
  badgeConnected: boolean;
  ownerConnected: boolean;
  ownerContainsBadge: boolean;
  sourceConnected: boolean;
  ownerMatchesSource: boolean;
  textVersionMatches: boolean;
  rangeMatches: boolean;
  fingerprintMatches: boolean;
  staleRecordRemoved: boolean;
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
  existingBadge?: HTMLElement;
  reconciliation: ReconciliationDiagnostic;
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

function currentParserInput(record: ProcessedMatchRecord): string {
  return record.inputNodes.map((node) => node.textContent ?? "").join("");
}

function inspectRecord(
  record: ProcessedMatchRecord | undefined,
  candidate: CurrencyDomMatch,
  targetCurrency: string,
  sourceFingerprint: string
): ReconciliationDiagnostic {
  const owner = record?.badge.parentElement ?? null;
  const badgeConnected = record?.badge.isConnected ?? false;
  const sourceConnected = record?.sourceNodes.every((node) => node.isConnected) ?? candidate.sourceNodes.every((node) => node.isConnected);
  const ownerConnected = owner?.isConnected ?? false;
  const ownerContainsBadge = !!owner && !!record && owner.contains(record.badge);
  const ownerMatchesSource = !!record && !!owner && candidate.sourceNodes.every((node) => owner.contains(node)) &&
    record.sourceNodes.length === candidate.sourceNodes.length &&
    record.sourceNodes.every((node, index) => node === candidate.sourceNodes[index]) &&
    record.anchor === candidate.renderingAnchor && candidate.sourceNodes.every((node) => record.anchor.contains(node));
  const textVersionMatches = !!record && record.parserInput === candidate.parserInput && currentParserInput(record) === record.parserInput;
  const rangeMatches = !!record && record.start === candidate.match.start && record.end === candidate.match.end &&
    record.sourceCurrency === candidate.match.currency && record.amount === candidate.match.amount &&
    record.targetCurrency === targetCurrency &&
    currentParserInput(record).slice(record.start, record.end) === candidate.match.raw;
  const fingerprintMatches = !!record && record.badge.dataset.ehiniumSourceFingerprint === sourceFingerprint;
  return {
    ownerRecordFound: record !== undefined,
    badgeConnected,
    ownerConnected,
    ownerContainsBadge,
    sourceConnected,
    ownerMatchesSource,
    textVersionMatches,
    rangeMatches,
    fingerprintMatches,
    staleRecordRemoved: false,
  };
}

function removeStaleRecords(primaryNode: Text, inputVersion: string): boolean {
  const records = processedMatches.get(primaryNode);
  if (!records) {
    return false;
  }

  let removed = false;

  for (const [key, record] of records) {
    if (record.inputVersion !== inputVersion) {
      markBadgeRemovalIntentional(record.badge);
      record.badge.remove();
      records.delete(key);
      removed = true;
    } else if (!record.badge.isConnected) {
      records.delete(key);
      removed = true;
    }
  }

  if (records.size === 0) {
    processedMatches.delete(primaryNode);
  }
  return removed;
}

function badgesInScope(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[data-ehinium-badge="true"]')];
}

function applyOwnershipMetadata(
  badge: HTMLElement,
  candidate: CurrencyDomMatch,
  targetCurrency: string,
  decision: Pick<DuplicateDecision, "ownerPositionKey" | "sourceFingerprint" | "scopeFingerprint">
): void {
  badge.setAttribute("data-euc-owned", "true");
  badge.setAttribute("data-euc-badge", "true");
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
  const beforeCleanup = processedMatches.get(primaryNode)?.get(processedMatchKey);
  const staleRecordRemoved = removeStaleRecords(primaryNode, inputVersion);
  const exactRecord = processedMatches.get(primaryNode)?.get(processedMatchKey);
  const base = {
    processedMatchKey,
    sourceFingerprint: ownership.sourceFingerprint,
    scopeFingerprint: ownership.scopeFingerprint,
    ownerPositionKey: ownership.ownerPositionKey,
  };

  const reconciliation = inspectRecord(
    exactRecord ?? beforeCleanup,
    candidate,
    targetCurrency,
    ownership.sourceFingerprint
  );
  reconciliation.staleRecordRemoved = staleRecordRemoved;

  if (
    exactRecord &&
    reconciliation.badgeConnected &&
    reconciliation.ownerConnected &&
    reconciliation.ownerContainsBadge &&
    reconciliation.sourceConnected &&
    reconciliation.ownerMatchesSource &&
    reconciliation.textVersionMatches &&
    reconciliation.rangeMatches &&
    reconciliation.fingerprintMatches
  ) {
    return {
      ...base,
      duplicate: true,
      decision: "skip-exact-node-duplicate",
      reason: "Exact source node, text version, range, amount, currency, and target already owns a connected badge",
      badgeConnected: true,
      existingBadge: exactRecord.badge,
      reconciliation,
    };
  }

  if (exactRecord) {
    markBadgeRemovalIntentional(exactRecord.badge);
    exactRecord.badge.remove();
    processedMatches.get(primaryNode)?.delete(processedMatchKey);
    reconciliation.staleRecordRemoved = true;
    reconciliationCounters.removedStaleBadgeCount++;
  }

  const lineageBadges = findExistingLineageBadges(candidate, targetCurrency);
  if (lineageBadges.length > 0) {
    const badge = lineageBadges[0];
    const previousOwner = badge.dataset.ehiniumOwnerId;
    for (const duplicate of lineageBadges.slice(1)) {
      markBadgeRemovalIntentional(duplicate);
      duplicate.remove();
      reconciliationCounters.removedStaleBadgeCount++;
    }
    applyOwnershipMetadata(badge, candidate, targetCurrency, base);
    badge.setAttribute("data-ehinium-source-match", processedMatchKey);
    const records = processedMatches.get(primaryNode) ?? new Map();
    records.set(processedMatchKey, {
      inputVersion,
      badge,
      sourceNodes: [...candidate.sourceNodes],
      inputNodes: [...new Set(candidate.fragmentMap.map((fragment) => fragment.node))],
      anchor: candidate.renderingAnchor,
      parserInput: candidate.parserInput,
      start: candidate.match.start,
      end: candidate.match.end,
      sourceCurrency: candidate.match.currency,
      amount: candidate.match.amount,
      targetCurrency,
    });
    processedMatches.set(primaryNode, records);
    reconciliationCounters.adoptedBadgeCount++;
    return {
      ...base,
      duplicate: true,
      decision: "adopt-existing-badge",
      reason: "Existing badge owns same canonical text lineage",
      previousOwner,
      badgeConnected: true,
      existingBadge: badge,
      reconciliation: {
        ...reconciliation,
        ownerRecordFound: true,
        badgeConnected: true,
        ownerConnected: true,
        ownerContainsBadge: true,
        sourceConnected: true,
        ownerMatchesSource: true,
        textVersionMatches: true,
        rangeMatches: true,
        fingerprintMatches: true,
        staleRecordRemoved: reconciliation.staleRecordRemoved || lineageBadges.length > 1,
      },
    };
  }

  const scopeBadges = badgesInScope(ownership.scope);
  const staleAtPosition = scopeBadges.filter(
    (badge) => badge.dataset.ehiniumOwnerPosition === ownership.ownerPositionKey
  );
  for (const staleBadge of staleAtPosition) {
    markBadgeRemovalIntentional(staleBadge);
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
    reconciliation: {
      ...reconciliation,
      staleRecordRemoved: reconciliation.staleRecordRemoved || staleAtPosition.length > 0,
    },
  };
}

export function recordProcessedMatch(
  candidate: CurrencyDomMatch,
  targetCurrency: string,
  badge: HTMLElement,
  decision = getDuplicateDecision(candidate, targetCurrency),
  countAsNew = true
): string {
  const primaryNode = getPrimaryNode(candidate);
  const inputVersion = hashText(candidate.parserInput);
  const key = getProcessedMatchKey(candidate, targetCurrency);
  const records = processedMatches.get(primaryNode) ?? new Map();
  records.set(key, {
    inputVersion,
    badge,
    sourceNodes: [...candidate.sourceNodes],
    inputNodes: [...new Set(candidate.fragmentMap.map((fragment) => fragment.node))],
    anchor: candidate.renderingAnchor,
    parserInput: candidate.parserInput,
    start: candidate.match.start,
    end: candidate.match.end,
    sourceCurrency: candidate.match.currency,
    amount: candidate.match.amount,
    targetCurrency,
  });
  processedMatches.set(primaryNode, records);
  if (countAsNew) reconciliationCounters.newlyRenderedBadgeCount++;
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
      markBadgeRemovalIntentional(record.badge);
      record.badge.remove();
    }
    processedMatches.delete(node);
  }
}
