import { forgetBadgeHost, getBadgeVisibleText, isProtectedBadgeHost } from "./badgeHost";

export type BadgeHostRenderMode = "inline" | "overlay" | "legacy";

export type CompetingBadgeHostDiagnostic = {
  selector: string;
  renderMode: BadgeHostRenderMode;
  connected: boolean;
  ownerVersion: number;
  reason: string;
};

export type BadgeHostReconciliationDiagnostic = {
  canonicalSourceKey: string;
  registryRecordCount: number;
  domBadgeHostCount: number;
  inlineHostCount: number;
  overlayHostCount: number;
  legacyHostCount: number;
  orphanHostCount: number;
  authoritativeHostSelector: string | null;
  authoritativeRenderMode: BadgeHostRenderMode | null;
  competingHosts: CompetingBadgeHostDiagnostic[];
  competingHostsRemoved: number;
  finalDomBadgeHostCount: number;
  invariantSatisfied: boolean;
};

export type BadgeHostCensusDiagnostic = {
  totalRegistryRecordCount: number;
  totalDomBadgeHostCount: number;
  totalInlineHostCount: number;
  totalOverlayHostCount: number;
  totalLegacyHostCount: number;
  totalOrphanHostCount: number;
  totalCompetingHostCount: number;
  registryKeysWithMultipleDomHosts: string[];
  domHostsWithoutRegistryRecord: string[];
  registryRecordsWithoutConnectedHost: string[];
};

type BadgeHostRecord = {
  canonicalSourceKey: string;
  sourceFingerprint: string;
  sourceElement: HTMLElement | null;
  badgeHost: HTMLElement;
  renderMode: BadgeHostRenderMode;
  ownerVersion: number;
  amount: number | null;
  sourceCurrency: string | null;
  targetCurrency: string | null;
  convertedText: string;
  lastSeenAt: number;
};

type RegisterOptions = {
  sourceKey: string;
  badgeHost: HTMLElement;
  sourceElement: HTMLElement | null;
  renderMode: BadgeHostRenderMode;
  sourceFingerprint?: string;
  amount?: number;
  sourceCurrency?: string;
  targetCurrency?: string;
  creationReason: string;
  migrationOrigin?: string;
  supersede?: boolean;
};

const records = new Map<string, BadgeHostRecord>();
const latestDiagnostics = new Map<string, BadgeHostReconciliationDiagnostic>();
const standaloneSourceIds = new WeakMap<Node, string>();
let nextStandaloneSourceId = 1;
let removeHost: (host: HTMLElement, reason: string) => void = (host) => {
  forgetBadgeHost(host);
  host.remove();
};

function now(): number { return Date.now(); }

function selector(host: HTMLElement): string {
  const owner = host.dataset.ehiniumOwnerId;
  return `span[data-euc-badge-host="true"]${owner ? `[data-ehinium-owner-id="${owner}"]` : ""}`;
}

function modeOf(host: HTMLElement): BadgeHostRenderMode {
  const mode = host.dataset.eucRenderMode;
  return mode === "overlay" || mode === "inline" ? mode : "legacy";
}

function versionOf(host: HTMLElement): number {
  const value = Number(host.dataset.eucOwnerVersion);
  return Number.isFinite(value) ? value : 0;
}

function hostsForKey(key: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-euc-badge-host="true"][data-euc-source-key]')]
    .filter((host) => host.dataset.eucSourceKey === key && host.isConnected);
}

function applyIdentity(host: HTMLElement, record: BadgeHostRecord, reason: string, migrationOrigin?: string): void {
  host.dataset.eucSourceKey = record.canonicalSourceKey;
  host.dataset.eucRenderMode = record.renderMode;
  host.dataset.eucOwnerVersion = String(record.ownerVersion);
  host.dataset.eucSourceFingerprint = record.sourceFingerprint;
  host.dataset.eucCreationReason = host.dataset.eucCreationReason || reason;
  host.dataset.eucCreatedAt = host.dataset.eucCreatedAt || new Date().toISOString();
  host.dataset.eucLastReboundAt = new Date().toISOString();
  if (migrationOrigin) host.dataset.eucMigrationOrigin = migrationOrigin;
  host.dataset.eucSuperseded = "false";
  host.removeAttribute("data-euc-removal-reason");
}

function removeCompeting(host: HTMLElement, reason: string): void {
  host.dataset.eucSuperseded = "true";
  host.dataset.eucRemovalReason = reason;
  removeHost(host, reason);
}

function chooseAuthoritative(
  record: BadgeHostRecord | undefined,
  hosts: HTMLElement[],
  preferred?: HTMLElement
): HTMLElement | null {
  if (record?.badgeHost.isConnected && hosts.includes(record.badgeHost)) return record.badgeHost;
  if (preferred?.isConnected && hosts.includes(preferred)) return preferred;
  return [...hosts].sort((left, right) =>
    versionOf(right) - versionOf(left) ||
    Number(modeOf(right) === record?.renderMode) - Number(modeOf(left) === record?.renderMode) ||
    Number(isProtectedBadgeHost(right)) - Number(isProtectedBadgeHost(left))
  )[0] ?? null;
}

export function configureBadgeHostRemovalHandler(
  handler: (host: HTMLElement, reason: string) => void
): void {
  removeHost = handler;
}

export function registerAuthoritativeBadgeHost(options: RegisterOptions): HTMLElement {
  const previousKey = options.badgeHost.dataset.eucSourceKey;
  if (previousKey && previousKey !== options.sourceKey && records.get(previousKey)?.badgeHost === options.badgeHost) {
    records.delete(previousKey);
  }
  const existing = records.get(options.sourceKey);
  const shouldSupersede = options.supersede === true || !existing?.badgeHost.isConnected;
  const authoritative = existing?.badgeHost.isConnected && !shouldSupersede
    ? existing.badgeHost
    : options.badgeHost;
  const version = Math.max(existing?.ownerVersion ?? 0, versionOf(options.badgeHost)) +
    (authoritative !== existing?.badgeHost || options.renderMode !== existing?.renderMode ? 1 : 0);
  const record: BadgeHostRecord = {
    canonicalSourceKey: options.sourceKey,
    sourceFingerprint: options.sourceFingerprint ?? options.badgeHost.dataset.ehiniumSourceFingerprint ?? "",
    sourceElement: options.sourceElement,
    badgeHost: authoritative,
    renderMode: authoritative === options.badgeHost ? options.renderMode : modeOf(authoritative),
    ownerVersion: Math.max(1, version),
    amount: options.amount ?? existing?.amount ?? null,
    sourceCurrency: options.sourceCurrency ?? existing?.sourceCurrency ?? null,
    targetCurrency: options.targetCurrency ?? existing?.targetCurrency ?? null,
    convertedText: getBadgeVisibleText(authoritative),
    lastSeenAt: now(),
  };
  records.set(options.sourceKey, record);
  applyIdentity(authoritative, record, options.creationReason, options.migrationOrigin);
  if (options.badgeHost !== authoritative && options.badgeHost.isConnected) {
    options.badgeHost.dataset.eucSourceKey = options.sourceKey;
    removeCompeting(options.badgeHost, "Existing authoritative registry host retained");
  }
  if (existing?.badgeHost !== authoritative && existing?.badgeHost.isConnected) {
    removeCompeting(existing.badgeHost, "Badge host superseded by a newer owner");
  }
  return authoritative;
}

export function reconcileBadgeHostsForKey(key: string, preferred?: HTMLElement): HTMLElement | null {
  const record = records.get(key);
  const initialHosts = hostsForKey(key);
  const authoritative = record ? chooseAuthoritative(record, initialHosts, preferred) : null;
  const competing = initialHosts.filter((host) => host !== authoritative);
  const competingDiagnostics = competing.map((host) => ({
    selector: selector(host), renderMode: modeOf(host), connected: host.isConnected,
    ownerVersion: versionOf(host), reason: "Not authoritative registry host",
  }));
  for (const host of competing) removeCompeting(host, "Not authoritative registry host");
  if (record && authoritative) {
    record.badgeHost = authoritative;
    record.renderMode = modeOf(authoritative);
    record.lastSeenAt = now();
    applyIdentity(authoritative, record, "Existing canonical badge reused");
  } else if (record && !authoritative) {
    records.delete(key);
  }
  const finalHosts = hostsForKey(key);
  latestDiagnostics.set(key, {
    canonicalSourceKey: key, registryRecordCount: records.has(key) ? 1 : 0,
    domBadgeHostCount: initialHosts.length,
    inlineHostCount: initialHosts.filter((host) => modeOf(host) === "inline").length,
    overlayHostCount: initialHosts.filter((host) => modeOf(host) === "overlay").length,
    legacyHostCount: initialHosts.filter((host) => modeOf(host) === "legacy").length,
    orphanHostCount: initialHosts.filter((host) => host !== authoritative).length,
    authoritativeHostSelector: authoritative ? selector(authoritative) : null,
    authoritativeRenderMode: authoritative ? modeOf(authoritative) : null,
    competingHosts: competingDiagnostics, competingHostsRemoved: competing.length,
    finalDomBadgeHostCount: finalHosts.length,
    invariantSatisfied: record
      ? finalHosts.length === 1 && records.get(key)?.badgeHost === finalHosts[0]
      : finalHosts.length === 0,
  });
  return authoritative;
}

export function reconcileAffectedBadgeHosts(mutations: readonly MutationRecord[]): void {
  const keys = new Set<string>();
  for (const mutation of mutations) {
    const nodes = [mutation.target, ...mutation.addedNodes, ...mutation.removedNodes];
    for (const node of nodes) {
      const element = node instanceof Element ? node : node.parentElement;
      const hosts: HTMLElement[] = [];
      if (element?.matches('[data-euc-badge-host="true"]')) hosts.push(element as HTMLElement);
      const ancestor = element?.closest<HTMLElement>('[data-euc-badge-host="true"]');
      if (ancestor && !hosts.includes(ancestor)) hosts.push(ancestor);
      hosts.push(...element?.querySelectorAll<HTMLElement>('[data-euc-badge-host="true"]') ?? []);
      for (const host of hosts) {
        const key = host.dataset.eucSourceKey;
        if (key) keys.add(key);
      }
    }
  }
  for (const key of keys) reconcileBadgeHostsForKey(key);
}

export function reconcileAllBadgeHostRecords(): void {
  for (const key of [...records.keys()]) reconcileBadgeHostsForKey(key);
  for (const host of document.querySelectorAll<HTMLElement>('[data-euc-badge-host="true"][data-euc-source-key]')) {
    const key = host.dataset.eucSourceKey;
    if (key && !records.has(key)) removeCompeting(host, "DOM badge host has no registry record");
  }
}

export function registerStandaloneBadgeHost(
  host: HTMLElement,
  source: Node,
  sourceKeyPrefix: string,
  sourceElement: HTMLElement | null
): void {
  let sourceId = standaloneSourceIds.get(source);
  if (!sourceId) {
    sourceId = `standalone-${nextStandaloneSourceId++}`;
    standaloneSourceIds.set(source, sourceId);
  }
  registerAuthoritativeBadgeHost({
    sourceKey: `${sourceKeyPrefix}|${sourceId}`, badgeHost: host, sourceElement,
    renderMode: "inline", creationReason: "Standalone conversion badge inserted",
  });
}

export function unregisterBadgeHost(host: HTMLElement): void {
  const key = host.dataset.eucSourceKey;
  if (key && records.get(key)?.badgeHost === host) records.delete(key);
}

export function getBadgeHostReconciliationDiagnostics(): BadgeHostReconciliationDiagnostic[] {
  return [...latestDiagnostics.values()].map((item) => ({
    ...item,
    competingHosts: item.competingHosts.map((host) => ({ ...host })),
  }));
}

export function getBadgeHostCensusDiagnostic(): BadgeHostCensusDiagnostic {
  const hosts = [...document.querySelectorAll<HTMLElement>('[data-euc-badge-host="true"]')].filter((host) => host.isConnected);
  const keyed = hosts.filter((host) => !!host.dataset.eucSourceKey);
  const keysWithMultiple = [...new Set(keyed.map((host) => host.dataset.eucSourceKey!))]
    .filter((key) => keyed.filter((host) => host.dataset.eucSourceKey === key).length > 1);
  const withoutRecord = keyed.filter((host) => !records.has(host.dataset.eucSourceKey!));
  return {
    totalRegistryRecordCount: records.size,
    totalDomBadgeHostCount: hosts.length,
    totalInlineHostCount: hosts.filter((host) => modeOf(host) === "inline").length,
    totalOverlayHostCount: hosts.filter((host) => modeOf(host) === "overlay").length,
    totalLegacyHostCount: hosts.filter((host) => modeOf(host) === "legacy").length,
    totalOrphanHostCount: withoutRecord.length,
    totalCompetingHostCount: keysWithMultiple.reduce((total, key) =>
      total + Math.max(0, keyed.filter((host) => host.dataset.eucSourceKey === key).length - 1), 0),
    registryKeysWithMultipleDomHosts: keysWithMultiple,
    domHostsWithoutRegistryRecord: withoutRecord.map(selector),
    registryRecordsWithoutConnectedHost: [...records].filter(([, record]) => !record.badgeHost.isConnected).map(([key]) => key),
  };
}

export function clearBadgeHostRegistry(): void {
  records.clear();
  latestDiagnostics.clear();
}
