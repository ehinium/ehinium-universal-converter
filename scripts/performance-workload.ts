export type AuditWorkloadContract = {
  minimumScannedTextNodes?: number;
  minimumParserCalls?: number;
  minimumParserMatches?: number;
  minimumCanonicalCandidates?: number;
  minimumActiveBadges?: number;
  minimumRenderedBadges?: number;
  minimumMutationBatches?: number;
  requireSuccessfulStabilization?: boolean;
  requireNoPendingWork?: boolean;
  requireRegistryDomParity?: boolean;
  maximumOrphanBadgeHosts?: number;
  maximumCompetingBadgeHosts?: number;
};

export type WorkloadObserved = {
  scannedTextNodes: number | null;
  parserCalls: number | null;
  parserMatches: number | null;
  canonicalCandidates: number | null;
  activeBadges: number | null;
  renderedBadges: number | null;
  mutationBatches: number | null;
  stabilizationSucceeded: boolean | null;
  pendingWorkCount: number | null;
  registryRecordCount: number | null;
  domBadgeHostCount: number | null;
  registryDomParity: boolean | null;
  orphanBadgeHosts: number | null;
  competingBadgeHosts: number | null;
};

export type WorkloadValidation = {
  valid: boolean;
  status: "valid" | "invalid" | "partial" | "unsupported";
  contract: AuditWorkloadContract;
  observed: WorkloadObserved;
  failedConditions: string[];
  warnings: string[];
};

type CounterMap = Record<string, number>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pendingCount(value: unknown): number | null {
  const pending = record(value);
  if (!pending) return null;
  return Object.values(pending).filter((item) => typeof item === "number" ? item > 0 : item === true).length;
}

export function observeWorkload(run: Record<string, unknown>): WorkloadObserved {
  const cold = record(run.cold);
  const diagnostics = record(cold?.extensionDiagnostics);
  const counters = record(diagnostics?.counters) as CounterMap | null;
  const census = record(diagnostics?.badgeHostCensus);
  const dom = record(cold?.dom);
  const pageWorkload = record(cold?.pageWorkload);
  const stabilization = record(cold?.stabilization);
  const registryRecordCount = finite(census?.totalRegistryRecordCount);
  const domBadgeHostCount = finite(census?.totalDomBadgeHostCount) ?? finite(pageWorkload?.activeBadgeCount);
  return {
    scannedTextNodes: finite(counters?.textNodesScanned) ?? finite(dom?.textNodeCount),
    parserCalls: finite(counters?.parserCalls),
    parserMatches: finite(counters?.parserMatches) ?? finite(pageWorkload?.inferredParserMatches),
    canonicalCandidates: finite(counters?.canonicalCandidates) ?? finite(pageWorkload?.inferredParserMatches),
    activeBadges: finite(diagnostics?.activeBadgeCount) ?? finite(pageWorkload?.activeBadgeCount),
    renderedBadges: counters ? (counters.inlineBadgesInserted ?? 0) + (counters.overlayBadgesInserted ?? 0) : finite(pageWorkload?.inferredRenderedBadges),
    mutationBatches: finite(counters?.mutationCallbackCount) ?? finite(pageWorkload?.mutationBatchCount),
    stabilizationSucceeded: typeof stabilization?.stable === "boolean" ? stabilization.stable : null,
    pendingWorkCount: pendingCount(diagnostics?.pendingWork) ?? finite(pageWorkload?.pendingWorkCount),
    registryRecordCount,
    domBadgeHostCount,
    registryDomParity: registryRecordCount === null || domBadgeHostCount === null ? null : registryRecordCount === domBadgeHostCount,
    orphanBadgeHosts: finite(census?.totalOrphanHostCount),
    competingBadgeHosts: finite(census?.totalCompetingHostCount),
  };
}

export function validateWorkload(contract: AuditWorkloadContract, observed: WorkloadObserved): WorkloadValidation {
  const failedConditions: string[] = [];
  const unsupported: string[] = [];
  const minimum = (key: keyof WorkloadObserved, expected: number | undefined, label: string): void => {
    if (expected === undefined) return;
    const actual = observed[key];
    if (typeof actual !== "number") unsupported.push(`${label} is unavailable`);
    else if (actual < expected) failedConditions.push(`${label} ${actual} is below required minimum ${expected}`);
  };
  const maximum = (key: keyof WorkloadObserved, expected: number | undefined, label: string): void => {
    if (expected === undefined) return;
    const actual = observed[key];
    if (typeof actual !== "number") unsupported.push(`${label} is unavailable`);
    else if (actual > expected) failedConditions.push(`${label} ${actual} exceeds maximum ${expected}`);
  };
  minimum("scannedTextNodes", contract.minimumScannedTextNodes, "scanned text nodes");
  minimum("parserCalls", contract.minimumParserCalls, "parser calls");
  minimum("parserMatches", contract.minimumParserMatches, "parser matches");
  minimum("canonicalCandidates", contract.minimumCanonicalCandidates, "canonical candidates");
  minimum("activeBadges", contract.minimumActiveBadges, "active badges");
  minimum("renderedBadges", contract.minimumRenderedBadges, "rendered badges");
  minimum("mutationBatches", contract.minimumMutationBatches, "mutation batches");
  maximum("orphanBadgeHosts", contract.maximumOrphanBadgeHosts, "orphan badge hosts");
  maximum("competingBadgeHosts", contract.maximumCompetingBadgeHosts, "competing badge hosts");
  if (contract.requireSuccessfulStabilization) {
    if (observed.stabilizationSucceeded === null) unsupported.push("stabilization result is unavailable");
    else if (!observed.stabilizationSucceeded) failedConditions.push("stabilization did not succeed");
  }
  if (contract.requireNoPendingWork) {
    if (observed.pendingWorkCount === null) unsupported.push("pending work is unavailable");
    else if (observed.pendingWorkCount > 0) failedConditions.push(`${observed.pendingWorkCount} pending work field(s) remain active`);
  }
  if (contract.requireRegistryDomParity) {
    if (observed.registryDomParity === null) unsupported.push("registry/DOM parity is unavailable");
    else if (!observed.registryDomParity) failedConditions.push(`registry/DOM mismatch (${observed.registryRecordCount} registry records, ${observed.domBadgeHostCount} DOM hosts)`);
  }
  const status = failedConditions.length > 0 ? "invalid" : unsupported.length > 0 ? "partial" : "valid";
  return { valid: status === "valid", status, contract: { ...contract }, observed: { ...observed },
    failedConditions, warnings: unsupported };
}

export function defaultContractForUrl(url: string): AuditWorkloadContract {
  if (url.includes("/static-prices.html")) return { minimumScannedTextNodes: 100, minimumParserMatches: 1,
    minimumActiveBadges: 1, minimumRenderedBadges: 1, requireSuccessfulStabilization: true, requireNoPendingWork: true };
  if (url.includes("/large-page.html")) return { minimumScannedTextNodes: 1000, requireSuccessfulStabilization: true };
  if (url.includes("/mutation-heavy-spa.html")) return { minimumScannedTextNodes: 1, minimumMutationBatches: 1, requireSuccessfulStabilization: true };
  if (url.includes("/translation-wrappers.html")) return { minimumScannedTextNodes: 1, minimumMutationBatches: 1,
    requireSuccessfulStabilization: true, requireNoPendingWork: true, requireRegistryDomParity: true,
    maximumOrphanBadgeHosts: 0, maximumCompetingBadgeHosts: 0 };
  return { minimumScannedTextNodes: 1 };
}

export function modeRunCounts(runs: Array<Record<string, unknown>>): {
  measuredRunCount: number; validMeasuredRunCount: number; invalidMeasuredRunCount: number;
  unsupportedMeasuredRunCount: number; excludedFromSummaryCount: number;
} {
  const measured = runs.filter((run) => !run.warmup);
  const validations = measured.map((run) => record(run.workloadValidation));
  const valid = validations.filter((item) => item?.valid === true).length;
  const unsupportedCount = validations.filter((item) => item?.status === "unsupported").length;
  return { measuredRunCount: measured.length, validMeasuredRunCount: valid,
    invalidMeasuredRunCount: measured.length - valid - unsupportedCount,
    unsupportedMeasuredRunCount: unsupportedCount, excludedFromSummaryCount: measured.length - valid };
}
