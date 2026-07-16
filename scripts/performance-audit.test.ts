import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { buildExtensions, createSpawnInvocation, createWarnings, PROJECT_ROOT, redact, resolveCommand, runCommand, summarizeNumbers, summarizeRuns } from "./performance-audit";
import { getDetailedPerfReport, recordPerfBatch, resetPerfDiagnostics, setPendingWorkProvider, waitForPerfIdle } from "../src/content/perfDiagnostics";

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

const window = new Window({ url: "https://fixture.invalid" });
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  NodeFilter: window.NodeFilter, performance: window.performance });
resetPerfDiagnostics();
for (let index = 0; index < 550; index++) recordPerfBatch({ trigger: "test", totalDuration: index });
const report = getDetailedPerfReport() as { batches: unknown[]; archivedBatchTotals: { count: number } };
assert.equal(report.batches.length, 500, "batch ring buffer must remain bounded");
assert.equal(report.archivedBatchTotals.count, 50);
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

console.log("performance audit infrastructure tests passed");
