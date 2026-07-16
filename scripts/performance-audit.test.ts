import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { buildExtensions, createSpawnInvocation, createWarnings, markdown, PROJECT_ROOT, redact, resolveCommand, runCommand, shouldFailForInvalidWorkload, summarizeNumbers, summarizeRuns } from "./performance-audit";
import { getDetailedPerfReport, measureAsync, measurePerfAsync, measureScheduled, measureSync, recordPerfBatch, resetPerfDiagnostics, setPendingWorkProvider, waitForPerfIdle } from "../src/content/perfDiagnostics";
import { modeRunCounts, observeWorkload, validateWorkload } from "./performance-workload";
import { googleStorePixelConfigScenario } from "../performance-scenarios/google-store-pixel-config";
import { trendyolManualTranslationScenario } from "../performance-scenarios/trendyol-manual-translation";
import type { PerformanceScenarioContext } from "../performance-scenarios/types";

const root = resolve(import.meta.dirname, "..");

type SpawnOptions = Parameters<typeof spawn>[2];

function fakeChild(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}

async function captureRejection(operation: Promise<void>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }

  assert.fail("Expected operation to reject");
}

assert.equal(resolveCommand("npm", "win32"), "npm.cmd");
assert.equal(resolveCommand("npm", "linux"), "npm");
assert.equal(resolveCommand("npm", "darwin"), "npm");
assert.equal(resolveCommand("git", "win32"), "git");
assert.equal(PROJECT_ROOT, root);
const windowsNpmInvocation = createSpawnInvocation("npm.cmd", ["run", "build"], "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" });
assert.equal(windowsNpmInvocation.executable, "C:\\Windows\\System32\\cmd.exe");
assert.deepEqual(windowsNpmInvocation.args, ["/d", "/s", "/c", "npm.cmd run build"]);
assert.equal(windowsNpmInvocation.logicalCommand, "npm.cmd run build");
const linuxNpmInvocation = createSpawnInvocation("npm", ["run", "build"], "linux", {});
assert.equal(linuxNpmInvocation.executable, "npm");
assert.deepEqual(linuxNpmInvocation.args, ["run", "build"]);

const exitFailure = await captureRejection(
  runCommand("npm", ["run", "build"], { cwd: root }, () => {
    const child = fakeChild();
    queueMicrotask(() => child.emit("exit", 7, "SIGTERM"));
    return child;
  }),
);
assert.match(exitFailure.message, /npm(?:\.cmd)? run build/);
assert.match(exitFailure.message, /arguments: \["run","build"\]/);
assert.match(exitFailure.message, /exit code: 7/);
assert.match(exitFailure.message, /signal: SIGTERM/);
assert.match(exitFailure.message, new RegExp(`cwd: ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
assert.match(exitFailure.message, /stdout: inherited/);
assert.match(exitFailure.message, /stderr: inherited/);

const originalStartupError = new Error("original startup failure");
const startupFailure = await captureRejection(
  runCommand("missing-command", [], { cwd: root }, () => {
    const child = fakeChild();
    queueMicrotask(() => child.emit("error", originalStartupError));
    return child;
  }),
);
assert.match(startupFailure.message, /original startup failure/);
assert.equal(startupFailure.cause, originalStartupError);

let receivedEnvironment: NodeJS.ProcessEnv | undefined;
await runCommand("node", ["--version"], { cwd: root, env: { ...process.env, EUC_TEST_ENV: "preserved" } },
  (_command, _args, options) => {
    receivedEnvironment = (options as SpawnOptions).env;
    const child = fakeChild();
    queueMicrotask(() => child.emit("exit", 0, null));
    return child;
  });
assert.equal(receivedEnvironment?.EUC_TEST_ENV, "preserved");
assert.equal((receivedEnvironment as NodeJS.ProcessEnv).PATH, process.env.PATH);

const buildCalls: Array<{ command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }> = [];
await buildExtensions(async (command, args, options) => {
  buildCalls.push({ command, args: [...args], cwd: options.cwd, env: options.env });
}, root, process.env);
assert.deepEqual(buildCalls.map((call) => call.args), [["run", "build"], ["run", "build:perf"]]);
assert.ok(buildCalls.every((call) => call.command === "npm"));
assert.ok(buildCalls.every((call) => call.cwd === root));
assert.equal(buildCalls[0].env?.PATH, process.env.PATH);
assert.equal(buildCalls[1].env?.PATH, process.env.PATH);
assert.equal(buildCalls[1].env?.EUC_PERFORMANCE_DIAGNOSTICS, "true");

function run(summaryValue: number, warmup = false): Record<string, unknown> {
  return { warmup, cold: { navigation: { loadEventEnd: summaryValue }, paint: { fcp: summaryValue, lcp: summaryValue, cls: 0 },
    longTasks: { totalBlockingTime: summaryValue, totalDuration: summaryValue }, memory: { usedJSHeapSize: summaryValue }, dom: { nodeCount: summaryValue } } };
}

const stats = summarizeNumbers([1, 2, 3, 4, 100]);
assert.equal(stats.median, 3);
assert.equal(stats.p75, 4);
assert.equal(stats.p95, 100);
assert.equal(stats.min, 1);
assert.equal(stats.max, 100);
assert.ok(stats.standardDeviation > 0);

const summarized = summarizeRuns([run(999, true), run(100), run(200), run(300)]);
assert.equal(summarized["cold.navigation.loadEventEnd"].median, 200, "warm-up must not affect summaries");

const invalidWorkload = validateWorkload({ minimumParserMatches: 1 }, {
  scannedTextNodes: 10, parserCalls: 1, parserMatches: 0, canonicalCandidates: 0, activeBadges: 0,
  renderedBadges: 0, mutationBatches: 0, stabilizationSucceeded: true, pendingWorkCount: 0,
  registryRecordCount: 0, domBadgeHostCount: 0, registryDomParity: true, orphanBadgeHosts: 0, competingBadgeHosts: 0,
});
assert.equal(invalidWorkload.valid, false);
assert.match(invalidWorkload.failedConditions[0], /parser matches 0/);
const validRun = { ...run(100), workloadValidation: { ...invalidWorkload, valid: true, status: "valid" } };
const invalidRun = { ...run(999), workloadValidation: invalidWorkload, diagnosticMarker: "retained" };
assert.equal(summarizeRuns([validRun, invalidRun])["cold.navigation.loadEventEnd"].median, 100);
assert.equal(invalidRun.diagnosticMarker, "retained", "invalid diagnostics remain in the JSON run object");
const genericValidation = validateWorkload({ minimumScannedTextNodes: 1 }, observeWorkload({ cold: { dom: { textNodeCount: 5 }, pageWorkload: { activeBadgeCount: 0 }, stabilization: { stable: true } } }));
assert.equal(genericValidation.valid, true, "generic pages do not require a conversion match");
const parityFailure = validateWorkload({ requireRegistryDomParity: true, maximumOrphanBadgeHosts: 0, maximumCompetingBadgeHosts: 0 }, {
  ...invalidWorkload.observed, registryRecordCount: 2, domBadgeHostCount: 1, registryDomParity: false, orphanBadgeHosts: 1, competingBadgeHosts: 1,
});
assert.equal(parityFailure.failedConditions.length, 3);

const redacted = JSON.stringify(redact({ email: "person@example.com", password: "secret", cookie: "do-not-store", safe: "metric" }));
assert.ok(!redacted.includes("person@example.com"));
assert.ok(!redacted.includes("secret"));
assert.ok(!redacted.includes("do-not-store"));
assert.ok(redacted.includes("metric"));

const summaries = {
  baseline: summarizeRuns([run(100), run(100)]),
  "extension-disabled": summarizeRuns([run(102), run(102)]),
  "extension-enabled": summarizeRuns([run(130), run(130)]),
  "diagnostics-enabled": summarizeRuns([run(180), run(180)]),
};
const modeRuns = { baseline: [run(100)], "extension-disabled": [run(102)], "extension-enabled": [run(130)], "diagnostics-enabled": [run(180)] };
assert.ok(createWarnings(summaries, modeRuns).some((warning) => warning.includes("10%")));
assert.ok(createWarnings(summaries, modeRuns).some((warning) => warning.includes("25%")));
const attributionRuns = { ...modeRuns, "diagnostics-enabled": [{ ...run(180), cold: {
  ...run(180).cold as Record<string, unknown>, extensionDiagnostics: { counters: { inlineBadgesInserted: 0, overlayBadgesInserted: 0 }, timings: [
    { name: "initial-render", wallClockDurationMs: 75, synchronousCpuDurationMs: 0, asyncWaitDurationMs: 75, schedulingDelayMs: 0 },
    { name: "rates-network-request", wallClockDurationMs: 700, synchronousCpuDurationMs: 0, asyncWaitDurationMs: 700, schedulingDelayMs: 0 },
  ] },
} }] };
const attributionWarnings = createWarnings(summaries, attributionRuns);
assert.ok(attributionWarnings.some((warning) => warning.includes("zero badges")));
assert.ok(attributionWarnings.some((warning) => warning.includes("asynchronous wait")));

const window = new Window({ url: "https://fixture.invalid" });
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  NodeFilter: window.NodeFilter, performance: window.performance });
resetPerfDiagnostics();
const syncResult = measureSync("sync-test", () => 42);
assert.equal(syncResult, 42);
await measureAsync("async-test", async (timing) => {
  timing.measureSync("cpu", () => { for (let index = 0; index < 1000; index++) Math.sqrt(index); });
  await timing.measureAwait("network-wait", () => new Promise((resolvePromise) => setTimeout(resolvePromise, 20)));
});
await measurePerfAsync("unsupported-async", () => new Promise((resolvePromise) => setTimeout(resolvePromise, 15)));
await measureScheduled("scheduled-test", (callback) => setTimeout(callback, 15), () => 1);
for (let index = 0; index < 550; index++) recordPerfBatch({ trigger: "test", totalDuration: index });
const report = getDetailedPerfReport() as { batches: Array<{ longestSynchronousTask: number; batchWallClockDuration: number }>;
  archivedBatchTotals: { count: number }; timings: Array<Record<string, unknown>>; browserLongTasks: unknown[]; extensionSyncSlices: unknown[] };
assert.equal(report.batches.length, 500, "batch ring buffer must remain bounded");
assert.equal(report.archivedBatchTotals.count, 50);
assert.equal(report.batches.at(-1)?.batchWallClockDuration, 549);
assert.equal(report.batches.at(-1)?.longestSynchronousTask, 0, "async wall time is never defaulted to a sync task");
const asyncTiming = report.timings.find((timing) => timing.name === "async-test")!;
assert.ok(Number(asyncTiming.wallClockDurationMs) >= 15);
assert.ok(Number(asyncTiming.asyncWaitDurationMs) >= 15);
assert.ok(Number(asyncTiming.synchronousCpuDurationMs) < Number(asyncTiming.wallClockDurationMs));
assert.equal(report.timings.find((timing) => timing.name === "async-test:network-wait")?.synchronousCpuDurationMs, 0,
  "rate/network-style awaited time must not be counted as synchronous CPU");
const unsupportedAsync = report.timings.find((timing) => timing.name === "unsupported-async")!;
assert.equal(unsupportedAsync.synchronousCpuDurationMs, null);
assert.equal(unsupportedAsync.maximumSynchronousSliceMs, null);
const scheduled = report.timings.find((timing) => timing.name === "scheduled-test")!;
assert.ok(Number(scheduled.schedulingDelayMs) >= 10);
assert.ok(Array.isArray(report.browserLongTasks) && Array.isArray(report.extensionSyncSlices));
const idle = await waitForPerfIdle({ quietWindowMs: 100, timeoutMs: 500 });
assert.equal(idle.stable, true);
setPendingWorkProvider(() => ({ scanInProgress: true }));
const timedOut = await waitForPerfIdle({ quietWindowMs: 100, timeoutMs: 150 });
assert.equal(timedOut.timedOut, true);
setPendingWorkProvider(() => ({}));
window.close();

const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");
const contentEntry = readFileSync(resolve(root, "src/content/index.ts"), "utf8");
assert.match(viteConfig, /__EUC_PERF_DIAGNOSTICS__.*performanceDiagnosticsEnabled/s);
assert.match(contentEntry, /PERF_DIAGNOSTICS_ENABLED/);
const productionBundle = resolve(root, "dist/assets/content.js");
if (existsSync(productionBundle)) {
  assert.ok(!readFileSync(productionBundle, "utf8").includes("ehinium-extension-performance/v1"), "production bundle must not expose the perf API");
}

const counts = modeRunCounts([validRun, invalidRun]);
assert.equal(counts.measuredRunCount, 2);
assert.equal(counts.validMeasuredRunCount, 1);
assert.equal(counts.invalidMeasuredRunCount, 1);
const allModeCounts = Object.fromEntries(["baseline", "extension-disabled", "extension-enabled", "diagnostics-enabled"].map((mode) => [mode, counts])) as Parameters<typeof shouldFailForInvalidWorkload>[0]["counts"];
assert.equal(shouldFailForInvalidWorkload({ strict: true, failOnInvalidWorkload: false, allowInvalidWorkload: false, warningCount: 0, counts: allModeCounts }), true);

const emptySummary = summarizeRuns([]);
const modeReport = Object.fromEntries(["baseline", "extension-disabled", "extension-enabled", "diagnostics-enabled"].map((mode) => [mode, {
  runs: [validRun, invalidRun], summary: emptySummary, ...counts,
}])) as Record<string, unknown>;
const markdownOutput = markdown({ audit: { startedAt: new Date().toISOString() }, environment: { chromiumVersion: "test" }, modes: modeReport,
  warnings: [], artifacts: [] });
assert.match(markdownOutput, /## Workload Validity/);
assert.match(markdownOutput, /\| baseline \| 2 \| 1 \| 1 \|/);

const fakeLocator = { waitFor: async () => undefined, first() { return this; }, last() { return this; }, isVisible: async () => false,
  count: async () => 0, nth() { return this; }, isChecked: async () => false, click: async () => undefined,
  filter() { return this; } };
const fakePage = { getByRole: () => fakeLocator, getByText: () => fakeLocator, locator: () => fakeLocator,
  waitForTimeout: async () => undefined, setViewportSize: async () => undefined, evaluate: async () => 1000 };
const scenarioContext = {
  page: fakePage,
  mode: "diagnostics-enabled", headless: false, runNumber: 1, cycles: 1, forceGcBetweenCycles: false,
  diagnostics: { getSnapshot: async () => ({}), markScenario: async () => undefined, getPendingWork: async () => ({}) },
  async recordStep<T>(_name: string, action: () => Promise<T>) { return action(); },
  waitForExtensionIdle: async () => undefined, waitForWorkload: async () => invalidWorkload.observed,
  captureWorkloadSnapshot: async () => invalidWorkload.observed, captureScreenshot: async () => "test.png",
  manualCheckpoint: async () => new Date().toISOString(),
} as unknown as PerformanceScenarioContext;
await assert.rejects(() => googleStorePixelConfigScenario.run(scenarioContext), /No semantic product configuration controls/);
await assert.rejects(() => trendyolManualTranslationScenario.run({ ...scenarioContext, headless: true }), /requires --headful/);
const confirmations: string[] = [];
const manualContext = { ...scenarioContext, headless: false,
  manualCheckpoint: async () => { const timestamp = new Date().toISOString(); confirmations.push(timestamp); return timestamp; } };
await trendyolManualTranslationScenario.run(manualContext);
assert.equal(confirmations.length, 3);
assert.ok(confirmations.every((timestamp) => !Number.isNaN(Date.parse(timestamp))));

if (existsSync(productionBundle)) {
  const productionText = readFileSync(productionBundle, "utf8");
  assert.ok(!productionText.includes("google-store-pixel-config"));
  assert.ok(!productionText.includes("trendyol-manual-translation"));
}

console.log("performance audit infrastructure tests passed");
