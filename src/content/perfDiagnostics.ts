import type { UserSettings } from "../types/settings";
import { getBadgeHostCensusDiagnostic } from "./badgeHostRegistry";

export type PerfStage =
  | "content-script-evaluation"
  | "settings-load"
  | "rates-cache-lookup"
  | "rates-network-request"
  | "initial-dom-scan"
  | "candidate-discovery"
  | "parser-execution"
  | "canonicalization"
  | "conversion-calculation"
  | "initial-render"
  | "badge-reconciliation"
  | "overlay-positioning"
  | "mutation-observer-callback"
  | "mutation-batch-collection"
  | "mutation-batch-processing"
  | "visibility-reconciliation"
  | "translation-reconciliation"
  | "cleanup";

type FrameBudget = "under-4ms" | "4-8ms" | "8-16.7ms" | "16.7-50ms" | "above-50ms";

export type PerfMeasurement = {
  name: PerfStage | string;
  startedAt: number;
  duration: number;
  batchId?: string;
};

export type DiagnosticTiming = {
  name: string;
  startedAt: number;
  wallClockDurationMs: number;
  synchronousCpuDurationMs: number | null;
  asyncWaitDurationMs: number | null;
  schedulingDelayMs: number | null;
  maximumSynchronousSliceMs: number | null;
  attribution: "measured" | "estimated" | "unsupported";
  batchId?: string;
};

export type ExtensionSyncSlice = {
  name: string;
  startedAt: number;
  durationMs: number;
  batchId?: string;
};

export type PerfBatch = {
  batchId: string;
  trigger: string;
  timestamp: string;
  affectedRootCount: number;
  affectedRootSelectors: string[];
  mutationCount: number;
  nodesVisited: number;
  textNodesScanned: number;
  parserCalls: number;
  candidateCount: number;
  canonicalCandidateCount: number;
  badgesInserted: number;
  badgesUpdated: number;
  badgesRemoved: number;
  stageDurations: Record<string, number>;
  totalDuration: number;
  batchWallClockDuration: number;
  maximumSynchronousSliceMs: number;
  longestSynchronousTask: number;
  frameBudget: FrameBudget;
  exceededFrameBudget: boolean;
  fullPageScan: boolean;
  fullPageScanReason?: string;
  estimatedDomCoveragePercent?: number;
};

type MemorySnapshot = {
  label: string;
  timestamp: string;
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
  domNodeCount: number;
  elementCount: number;
  textNodeCount: number;
  badgeHostCount: number;
  overlayBadgeCount: number;
  activeObservers: number;
  pendingAnimationFrames: number;
  retainedDetailedBatchCount: number;
};

type LongTaskRecord = {
  startTime: number;
  duration: number;
  attribution: "inferred" | "unattributed";
  activeStage?: string;
  batchId?: string;
};

type DiagnosticsState = {
  startedAt: string;
  settings: Partial<UserSettings> | null;
  counters: Record<string, number>;
  skippedByReason: Record<string, number>;
  measurements: PerfMeasurement[];
  timings: DiagnosticTiming[];
  extensionSyncSlices: ExtensionSyncSlice[];
  batches: PerfBatch[];
  archivedBatchTotals: { count: number; totalDuration: number };
  longTasks: LongTaskRecord[];
  memorySnapshots: MemorySnapshot[];
  scenarios: Array<{ name: string; timestamp: string }>;
  errors: string[];
};

const MAX_BATCHES = 500;
const MAX_MEASUREMENTS = 2000;
const MAX_LONG_TASKS = 500;
const MAX_SNAPSHOTS = 50;
const MAX_STRING = 160;
const COUNTER_NAMES = [
  "totalDomNodesVisited", "totalTextNodesVisited", "textNodesScanned", "textNodesSkipped", "priceLikeElementsInspected",
  "parserCalls", "parserMatches", "rejectedParserMatches", "splitPriceCandidates", "combinedParentCandidates", "canonicalCandidates",
  "canonicalGroups", "candidatesDiscardedAsDuplicates", "inlineBadgeAttempts", "inlineBadgesInserted", "inlineBadgesUpdated",
  "overlayBadgesInserted", "overlayBadgesUpdated", "staleBadgesRemoved", "duplicateBadgesRemoved", "badgeMigrations",
  "shadowBadgeHostsCreated", "sourceReplacementsRebound", "externallyRemovedBadges", "fallbackActivations", "mutationCallbackCount",
  "mutationRecordCount", "addedNodeCount", "removedNodeCount", "characterDataMutationCount", "attributeMutationCount",
  "extensionOnlyMutationBatches", "siteContentMutationBatches", "mixedMutationBatches", "ignoredMutationBatches", "processedRoots",
  "fullDocumentRescans", "localSubtreeRescans", "requestAnimationFrameCallbacks", "pendingJobs", "canceledJobs",
  "resizeObserverCallbacks", "intersectionObserverCallbacks", "scrollTriggeredPositionBatches", "resizeTriggeredPositionBatches",
  "debounceInvocations", "storageReads", "storageWrites", "rateCacheHits", "rateCacheMisses", "rateRequests",
  "rateRequestFailures", "retryCount", "bytesReceived",
] as const;
let activeStage: string | undefined;
let activeBatchId: string | undefined;
let longTaskObserver: PerformanceObserver | null = null;
let pendingWorkProvider: (() => Record<string, unknown>) | null = null;

function initialState(): DiagnosticsState {
  return {
    startedAt: new Date().toISOString(), settings: null,
    counters: Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])),
    skippedByReason: {}, measurements: [], timings: [], extensionSyncSlices: [], batches: [],
    archivedBatchTotals: { count: 0, totalDuration: 0 }, longTasks: [],
    memorySnapshots: [], scenarios: [], errors: [],
  };
}

let state = /* @__PURE__ */ initialState();

function bounded(value: string): string {
  return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/(password|token|authorization|cookie)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .slice(0, MAX_STRING);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function budget(duration: number): FrameBudget {
  if (duration < 4) return "under-4ms";
  if (duration < 8) return "4-8ms";
  if (duration < 16.7) return "8-16.7ms";
  if (duration < 50) return "16.7-50ms";
  return "above-50ms";
}

function selectorFor(node: Node): string {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return "(detached)";
  return bounded(`${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 2).map((name) => `.${name}`).join("")}`);
}

function trim<T>(items: T[], maximum: number): void {
  if (items.length > maximum) items.splice(0, items.length - maximum);
}

export function incrementPerfCounter(name: string, amount = 1, skipReason?: string): void {
  state.counters[name] = (state.counters[name] ?? 0) + amount;
  if (skipReason) state.skippedByReason[bounded(skipReason)] = (state.skippedByReason[bounded(skipReason)] ?? 0) + amount;
}

export function recordPerfMeasurement(name: PerfStage | string, startedAt: number, duration: number, batchId?: string): void {
  state.measurements.push({ name, startedAt, duration: Math.max(0, duration), batchId });
  trim(state.measurements, MAX_MEASUREMENTS);
}

function recordTiming(timing: DiagnosticTiming): void {
  state.timings.push(timing);
  trim(state.timings, MAX_MEASUREMENTS);
}

function recordSyncSlice(name: string, startedAt: number, durationMs: number, batchId?: string): void {
  state.extensionSyncSlices.push({ name, startedAt, durationMs, batchId });
  trim(state.extensionSyncSlices, MAX_MEASUREMENTS);
}

export type SyncSliceToken = { name: string; startedAt: number; batchId?: string };

export function startSyncSlice(name: string, batchId?: string): SyncSliceToken {
  return { name: bounded(name), startedAt: performance.now(), batchId };
}

export function endSyncSlice(token: SyncSliceToken): number {
  const durationMs = Math.max(0, performance.now() - token.startedAt);
  recordSyncSlice(token.name, token.startedAt, durationMs, token.batchId);
  return durationMs;
}

export function getMaximumSyncSliceSince(startedAt: number): number {
  return state.extensionSyncSlices.filter((slice) => slice.startedAt >= startedAt)
    .reduce((maximum, slice) => Math.max(maximum, slice.durationMs), 0);
}

export function measureSync<T>(name: PerfStage | string, operation: () => T, batchId?: string): T {
  const token = startSyncSlice(name, batchId);
  const previousStage = activeStage;
  const previousBatch = activeBatchId;
  activeStage = name;
  activeBatchId = batchId;
  try { return operation(); }
  finally {
    const duration = endSyncSlice(token);
    recordPerfMeasurement(name, token.startedAt, duration, batchId);
    recordTiming({ name, startedAt: token.startedAt, wallClockDurationMs: duration,
      synchronousCpuDurationMs: duration, asyncWaitDurationMs: 0, schedulingDelayMs: 0,
      maximumSynchronousSliceMs: duration, attribution: "measured", batchId });
    activeStage = previousStage;
    activeBatchId = previousBatch;
  }
}

export async function measureAwait<T>(name: PerfStage | string, promiseFactory: () => Promise<T>, batchId?: string): Promise<T> {
  const startedAt = performance.now();
  try { return await promiseFactory(); }
  finally {
    const duration = Math.max(0, performance.now() - startedAt);
    recordPerfMeasurement(name, startedAt, duration, batchId);
    recordTiming({ name, startedAt, wallClockDurationMs: duration, synchronousCpuDurationMs: 0,
      asyncWaitDurationMs: duration, schedulingDelayMs: 0, maximumSynchronousSliceMs: 0,
      attribution: "estimated", batchId });
  }
}

export type AsyncTimingContext = {
  measureSync: <T>(name: string, operation: () => T) => T;
  measureAwait: <T>(name: string, promiseFactory: () => Promise<T>) => Promise<T>;
};

export async function measureAsync<T>(name: PerfStage | string, operation: (timing: AsyncTimingContext) => Promise<T>, batchId?: string): Promise<T> {
  const startedAt = performance.now();
  let synchronousCpuDurationMs = 0;
  let measuredAwaitDurationMs = 0;
  let maximumSynchronousSliceMs = 0;
  const timing: AsyncTimingContext = {
    measureSync<TValue>(childName: string, childOperation: () => TValue): TValue {
      const sliceStartedAt = performance.now();
      try { return childOperation(); }
      finally {
        const duration = Math.max(0, performance.now() - sliceStartedAt);
        synchronousCpuDurationMs += duration;
        maximumSynchronousSliceMs = Math.max(maximumSynchronousSliceMs, duration);
        recordSyncSlice(`${name}:${childName}`, sliceStartedAt, duration, batchId);
      }
    },
    async measureAwait<TValue>(childName: string, promiseFactory: () => Promise<TValue>): Promise<TValue> {
      const waitStartedAt = performance.now();
      try { return await promiseFactory(); }
      finally {
        const duration = Math.max(0, performance.now() - waitStartedAt);
        measuredAwaitDurationMs += duration;
        recordTiming({ name: `${name}:${childName}`, startedAt: waitStartedAt, wallClockDurationMs: duration,
          synchronousCpuDurationMs: 0, asyncWaitDurationMs: duration, schedulingDelayMs: 0,
          maximumSynchronousSliceMs: 0, attribution: "estimated", batchId });
      }
    },
  };
  try { return await operation(timing); }
  finally {
    const wallClockDurationMs = Math.max(0, performance.now() - startedAt);
    const asyncWaitDurationMs = Math.max(measuredAwaitDurationMs, wallClockDurationMs - synchronousCpuDurationMs);
    recordPerfMeasurement(name, startedAt, wallClockDurationMs, batchId);
    recordTiming({ name, startedAt, wallClockDurationMs, synchronousCpuDurationMs,
      asyncWaitDurationMs, schedulingDelayMs: 0, maximumSynchronousSliceMs,
      attribution: "measured", batchId });
  }
}

export function measureScheduled<T>(name: PerfStage | string, scheduler: (callback: () => void) => void, callback: () => T | Promise<T>, batchId?: string): Promise<T> {
  const requestedAt = performance.now();
  return new Promise<T>((resolvePromise, reject) => {
    scheduler(() => {
      const startedAt = performance.now();
      const schedulingDelayMs = Math.max(0, startedAt - requestedAt);
      const token = startSyncSlice(name, batchId);
      let result: T | Promise<T>;
      try { result = callback(); }
      catch (error) { endSyncSlice(token); reject(error); return; }
      const synchronousSlice = endSyncSlice(token);
      const finish = (): void => {
        const wallClockDurationMs = Math.max(0, performance.now() - requestedAt);
        recordTiming({ name, startedAt: requestedAt, wallClockDurationMs,
          synchronousCpuDurationMs: synchronousSlice, asyncWaitDurationMs: Math.max(0, wallClockDurationMs - schedulingDelayMs - synchronousSlice),
          schedulingDelayMs, maximumSynchronousSliceMs: synchronousSlice, attribution: "measured", batchId });
      };
      Promise.resolve(result).then((value) => { finish(); resolvePromise(value); }, (error) => { finish(); reject(error); });
    });
  });
}

export function measurePerf<T>(name: PerfStage | string, operation: () => T, batchId?: string): T {
  return measureSync(name, operation, batchId);
}

export async function measurePerfAsync<T>(name: PerfStage | string, operation: () => Promise<T>, batchId?: string): Promise<T> {
  const startedAt = performance.now();
  try { return await operation(); }
  finally {
    const wallClockDurationMs = Math.max(0, performance.now() - startedAt);
    recordPerfMeasurement(name, startedAt, wallClockDurationMs, batchId);
    recordTiming({ name, startedAt, wallClockDurationMs, synchronousCpuDurationMs: null,
      asyncWaitDurationMs: null, schedulingDelayMs: null, maximumSynchronousSliceMs: null,
      attribution: "unsupported", batchId });
  }
}

export function recordPerfBatch(input: Partial<PerfBatch> & Pick<PerfBatch, "trigger" | "totalDuration">): PerfBatch {
  const fullPageScan = input.fullPageScan ?? false;
  const maximumSynchronousSliceMs = input.maximumSynchronousSliceMs ?? input.longestSynchronousTask ?? 0;
  const batch: PerfBatch = {
    batchId: input.batchId ?? `batch-${state.archivedBatchTotals.count + state.batches.length + 1}`,
    trigger: bounded(input.trigger), timestamp: new Date().toISOString(),
    affectedRootCount: input.affectedRootCount ?? 0,
    affectedRootSelectors: (input.affectedRootSelectors ?? []).slice(0, 20).map(bounded),
    mutationCount: input.mutationCount ?? 0, nodesVisited: input.nodesVisited ?? 0,
    textNodesScanned: input.textNodesScanned ?? 0, parserCalls: input.parserCalls ?? 0,
    candidateCount: input.candidateCount ?? 0, canonicalCandidateCount: input.canonicalCandidateCount ?? 0,
    badgesInserted: input.badgesInserted ?? 0, badgesUpdated: input.badgesUpdated ?? 0,
    badgesRemoved: input.badgesRemoved ?? 0, stageDurations: { ...(input.stageDurations ?? {}) },
    totalDuration: input.totalDuration, batchWallClockDuration: input.batchWallClockDuration ?? input.totalDuration,
    maximumSynchronousSliceMs,
    longestSynchronousTask: maximumSynchronousSliceMs,
    frameBudget: budget(maximumSynchronousSliceMs), exceededFrameBudget: maximumSynchronousSliceMs > 16.7,
    fullPageScan, fullPageScanReason: input.fullPageScanReason ? bounded(input.fullPageScanReason) : undefined,
    estimatedDomCoveragePercent: input.estimatedDomCoveragePercent,
  };
  state.batches.push(batch);
  if (state.batches.length > MAX_BATCHES) {
    const removed = state.batches.splice(0, state.batches.length - MAX_BATCHES);
    state.archivedBatchTotals.count += removed.length;
    state.archivedBatchTotals.totalDuration += removed.reduce((sum, item) => sum + item.totalDuration, 0);
  }
  return batch;
}

export function recordMutationBatch(mutations: readonly MutationRecord[], roots: readonly Node[], duration: number): void {
  const extensionOwned = mutations.filter((mutation) => {
    const element = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    return Boolean(element?.closest("[data-ehinium-badge], [data-euc-owned], [data-ehinium-ignore]"));
  }).length;
  incrementPerfCounter("mutationCallbackCount");
  incrementPerfCounter("mutationRecordCount", mutations.length);
  incrementPerfCounter("addedNodeCount", mutations.reduce((sum, item) => sum + item.addedNodes.length, 0));
  incrementPerfCounter("removedNodeCount", mutations.reduce((sum, item) => sum + item.removedNodes.length, 0));
  incrementPerfCounter("characterDataMutationCount", mutations.filter((item) => item.type === "characterData").length);
  incrementPerfCounter("attributeMutationCount", mutations.filter((item) => item.type === "attributes").length);
  incrementPerfCounter(extensionOwned === mutations.length ? "extensionOnlyMutationBatches" : extensionOwned === 0 ? "siteContentMutationBatches" : "mixedMutationBatches");
  if (roots.length === 0) incrementPerfCounter("ignoredMutationBatches");
  recordPerfBatch({ trigger: "mutation-observer", totalDuration: duration, mutationCount: mutations.length,
    affectedRootCount: roots.length, affectedRootSelectors: roots.map(selectorFor), stageDurations: { collection: duration } });
}

export function setPerfSettings(settings: UserSettings): void {
  state.settings = { targetCurrency: settings.targetCurrency, enabled: settings.enabled, converterMode: settings.converterMode,
    badgeVisibility: settings.badgeVisibility, unitSystem: settings.unitSystem, whitelist: [...settings.whitelist], blacklist: [...settings.blacklist] };
}

export function capturePerfMemory(label: string): MemorySnapshot {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
  let textNodeCount = 0;
  while (walker.nextNode()) textNodeCount++;
  const snapshot: MemorySnapshot = { label: bounded(label), timestamp: new Date().toISOString(),
    usedJSHeapSize: memory?.usedJSHeapSize, totalJSHeapSize: memory?.totalJSHeapSize, jsHeapSizeLimit: memory?.jsHeapSizeLimit,
    domNodeCount: document.getElementsByTagName("*").length + textNodeCount, elementCount: document.getElementsByTagName("*").length,
    textNodeCount, badgeHostCount: document.querySelectorAll("[data-ehinium-badge], [data-euc-badge]").length,
    overlayBadgeCount: document.querySelectorAll('[data-ehinium-placement="overlay"]').length,
    activeObservers: longTaskObserver ? 1 : 0, pendingAnimationFrames: 0, retainedDetailedBatchCount: state.batches.length };
  state.memorySnapshots.push(snapshot); trim(state.memorySnapshots, MAX_SNAPSHOTS); return snapshot;
}

export function setPendingWorkProvider(provider: () => Record<string, unknown>): void { pendingWorkProvider = provider; }

export function startPerfDiagnostics(): void {
  capturePerfMemory("before-extension-initialization");
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
  longTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration,
      attribution: activeStage ? "inferred" : "unattributed", activeStage, batchId: activeBatchId });
    trim(state.longTasks, MAX_LONG_TASKS);
  });
  try { longTaskObserver.observe({ type: "longtask", buffered: true }); } catch { longTaskObserver = null; }
}

export function getPerfSnapshot(): Record<string, unknown> {
  return { schema: "ehinium-extension-performance/v1", startedAt: state.startedAt, settings: clone(state.settings),
    counters: clone(state.counters), batchCount: state.batches.length + state.archivedBatchTotals.count,
    activeBadgeCount: document.querySelectorAll("[data-ehinium-badge], [data-euc-badge]").length,
    badgeHostCensus: clone(getBadgeHostCensusDiagnostic()),
    pendingWork: clone(pendingWorkProvider?.() ?? {}), latestMemory: clone(state.memorySnapshots.at(-1) ?? null) };
}

export function getDetailedPerfReport(): Record<string, unknown> {
  const browserLongTasks = clone(state.longTasks);
  const extensionSyncSlices = clone(state.extensionSyncSlices);
  const overlaps = browserLongTasks.flatMap((task) => extensionSyncSlices
    .filter((slice) => slice.startedAt < task.startTime + task.duration && slice.startedAt + slice.durationMs > task.startTime)
    .map((slice) => ({ browserLongTaskStartTime: task.startTime, extensionSyncSliceName: slice.name,
      extensionSyncSliceStartTime: slice.startedAt, overlap: "inferred-possible-overlap" as const })));
  return { ...getPerfSnapshot(), ...clone(state), browserLongTasks, extensionSyncSlices, overlaps };
}
export function resetPerfDiagnostics(): void { state = initialState(); performance.clearMarks("euc:"); performance.clearMeasures("euc:"); }
export function markPerfScenario(name: string): void { state.scenarios.push({ name: bounded(name), timestamp: new Date().toISOString() }); trim(state.scenarios, 100); capturePerfMemory(`scenario:${name}`); }
export function getRecentPerfBatches(limit = 50): PerfBatch[] { return clone(state.batches.slice(-Math.max(0, Math.min(500, limit)))); }

export async function waitForPerfIdle(options: { quietWindowMs?: number; timeoutMs?: number } = {}): Promise<{ stable: boolean; waitedMs: number; timedOut: boolean }> {
  const quietWindowMs = Math.max(100, Math.min(5000, options.quietWindowMs ?? 1000));
  const timeoutMs = Math.max(quietWindowMs, Math.min(30000, options.timeoutMs ?? 15000));
  const started = performance.now(); let quietSince = performance.now(); let previous = JSON.stringify(pendingWorkProvider?.() ?? {});
  while (performance.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = JSON.stringify(pendingWorkProvider?.() ?? {});
    const pending = current !== "{}" && current !== '{"scanScheduled":false,"scanInProgress":false,"rescanRequested":false}';
    if (current !== previous || pending) quietSince = performance.now();
    previous = current;
    if (performance.now() - quietSince >= quietWindowMs) return { stable: true, waitedMs: performance.now() - started, timedOut: false };
  }
  return { stable: false, waitedMs: performance.now() - started, timedOut: true };
}

export type PerfDiagnosticsApi = {
  getSnapshot: typeof getPerfSnapshot; getDetailedReport: typeof getDetailedPerfReport;
  reset: typeof resetPerfDiagnostics; markScenario: typeof markPerfScenario; waitForIdle: typeof waitForPerfIdle;
  exportJson: () => string; getActiveBadgeCount: () => number; getPendingWork: () => Record<string, unknown>;
  getRecentBatches: typeof getRecentPerfBatches;
};

export function exposePerfDiagnosticsApi(): void {
  const api: PerfDiagnosticsApi = Object.freeze({ getSnapshot: getPerfSnapshot, getDetailedReport: getDetailedPerfReport,
    reset: resetPerfDiagnostics, markScenario: markPerfScenario, waitForIdle: waitForPerfIdle,
    exportJson: () => JSON.stringify(getDetailedPerfReport()),
    getActiveBadgeCount: () => document.querySelectorAll("[data-ehinium-badge], [data-euc-badge]").length,
    getPendingWork: () => clone(pendingWorkProvider?.() ?? {}), getRecentBatches: getRecentPerfBatches });
  Object.defineProperty(window, "__EUC_PERF_DIAGNOSTICS__", { configurable: true, value: api });
}

declare global { interface Window { __EUC_PERF_DIAGNOSTICS__?: PerfDiagnosticsApi; } }
