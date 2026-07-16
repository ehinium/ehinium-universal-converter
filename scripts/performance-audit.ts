import { createServer, type Server } from "node:http";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cpus, hostname, platform, release, totalmem } from "node:os";
import { dirname, extname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";

export type AuditMode = "baseline" | "extension-disabled" | "extension-enabled" | "diagnostics-enabled";
type ProfileName = "desktop" | "throttled";

type CliOptions = {
  urls: string[]; runs: number; profile: ProfileName; headless: boolean; trace: boolean;
  cpuProfile: boolean; screenshots: boolean; strict: boolean; skipBuild: boolean;
  outputDirectory: string; quietWindowMs: number; maxWaitMs: number; manualTranslation: boolean;
};

type NumericSummary = { median: number; p75: number; p95: number; min: number; max: number; standardDeviation: number };

const MODES: AuditMode[] = ["baseline", "extension-disabled", "extension-enabled", "diagnostics-enabled"];
export const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ROOT = PROJECT_ROOT;

type SpawnCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess;

type SpawnInvocation = {
  executable: string;
  args: string[];
  logicalCommand: string;
};

export function createSpawnInvocation(
  executable: string,
  args: string[],
  currentPlatform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): SpawnInvocation {
  const logicalCommand = `${executable} ${args.join(" ")}`;

  if (currentPlatform === "win32" && executable.toLowerCase().endsWith(".cmd")) {
    const commandProcessor = environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe";
    const commandLine = [executable, ...args].join(" ");
    return {
      executable: commandProcessor,
      args: ["/d", "/s", "/c", commandLine],
      logicalCommand,
    };
  }

  return { executable, args, logicalCommand };
}

export function resolveCommand(
  command: string,
  currentPlatform: NodeJS.Platform = process.platform,
): string {
  if (currentPlatform === "win32" && command === "npm") {
    return "npm.cmd";
  }

  return command;
}

export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
  spawnCommand: SpawnCommand = spawn,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const resolvedCommand = resolveCommand(command);
    const invocation = createSpawnInvocation(
      resolvedCommand,
      args,
      process.platform,
      options.env ?? process.env,
    );
    const commandLine = invocation.logicalCommand;
    const outputDetails = [
      "stdout: inherited (stdio: inherit)",
      "stderr: inherited (stdio: inherit)",
    ].join("\n");
    let child: ChildProcess;

    try {
      child = spawnCommand(invocation.executable, invocation.args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: "inherit",
        shell: false,
        windowsHide: false,
      });
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      reject(new Error(
        `Failed to start command: ${commandLine}\n` +
        `launcher: ${invocation.executable} ${invocation.args.join(" ")}\n` +
        `arguments: ${JSON.stringify(args)}\n` +
        `cwd: ${options.cwd}\n` +
        "exit code: unavailable\n" +
        "signal: unavailable\n" +
        `${outputDetails}\n` +
        `error: ${startupError.message}`,
        { cause: startupError },
      ));
      return;
    }

    child.once("error", (error) => {
      reject(new Error(
        `Failed to start command: ${commandLine}\n` +
        `launcher: ${invocation.executable} ${invocation.args.join(" ")}\n` +
        `arguments: ${JSON.stringify(args)}\n` +
        `cwd: ${options.cwd}\n` +
        "exit code: unavailable\n" +
        "signal: unavailable\n" +
        `${outputDetails}\n` +
        `error: ${error.message}`,
        { cause: error },
      ));
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(
        `Command failed: ${commandLine}\n` +
        `launcher: ${invocation.executable} ${invocation.args.join(" ")}\n` +
        `arguments: ${JSON.stringify(args)}\n` +
        `cwd: ${options.cwd}\n` +
        `exit code: ${code ?? "null"}\n` +
        `signal: ${signal ?? "none"}\n` +
        outputDetails,
      ));
    });
  });
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined;
}

export function parseArgs(args = process.argv.slice(2)): CliOptions {
  const url = valueAfter(args, "--url");
  const urlsFile = valueAfter(args, "--urls");
  let urls = url ? [url] : [];
  if (urlsFile) {
    const raw = JSON.parse(requireRead(resolve(ROOT, urlsFile))) as unknown;
    urls = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") :
      typeof raw === "object" && raw !== null && Array.isArray((raw as { urls?: unknown }).urls)
        ? (raw as { urls: unknown[] }).urls.filter((item): item is string => typeof item === "string") : [];
  }
  return {
    urls, runs: Math.max(2, Number(valueAfter(args, "--runs") ?? 5)),
    profile: valueAfter(args, "--profile") === "throttled" ? "throttled" : "desktop",
    headless: !args.includes("--headful"), trace: args.includes("--trace"), cpuProfile: args.includes("--cpu-profile"),
    screenshots: args.includes("--screenshot"), strict: args.includes("--strict"), skipBuild: args.includes("--skip-build"),
    outputDirectory: resolve(ROOT, valueAfter(args, "--output") ?? "performance-audits"),
    quietWindowMs: Math.max(100, Number(valueAfter(args, "--quiet-window") ?? 1000)),
    maxWaitMs: Math.max(1000, Number(valueAfter(args, "--max-wait") ?? 15000)),
    manualTranslation: args.includes("--manual-translation"),
  };
}

function requireRead(path: string): string {
  const result = spawnSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path)},'utf8'))`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Unable to read ${path}`);
  return result.stdout;
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1))];
}

export function summarizeNumbers(values: number[]): NumericSummary {
  if (!values.length) return { median: 0, p75: 0, p95: 0, min: 0, max: 0, standardDeviation: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { median: percentile(values, 0.5), p75: percentile(values, 0.75), p95: percentile(values, 0.95),
    min: Math.min(...values), max: Math.max(...values),
    standardDeviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) };
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/((?:password|token|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[redacted]")
    .slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 1000).map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|token|cookie|authorization|localStorage|responseBody|formValue/i.test(key))
    .map(([key, item]) => [key, redact(item)]));
  return value;
}

function metric(run: Record<string, unknown>, path: string): number {
  let current: unknown = run;
  for (const part of path.split(".")) current = current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

const SUMMARY_METRICS = ["cold.navigation.loadEventEnd", "cold.paint.fcp", "cold.paint.lcp", "cold.paint.cls",
  "cold.longTasks.totalBlockingTime", "cold.longTasks.totalDuration", "cold.memory.usedJSHeapSize", "cold.dom.nodeCount"];

export function summarizeRuns(runs: Array<Record<string, unknown>>): Record<string, NumericSummary> {
  return Object.fromEntries(SUMMARY_METRICS.map((path) => [path, summarizeNumbers(runs.filter((run) => !run.warmup).map((run) => metric(run, path))) ]));
}

function median(summary: Record<string, NumericSummary>, path: string): number { return summary[path]?.median ?? 0; }

export function createWarnings(summaries: Record<AuditMode, Record<string, NumericSummary>>, runs: Record<AuditMode, Array<Record<string, unknown>>>): string[] {
  const warnings: string[] = [];
  for (const mode of MODES) {
    const errorCount = runs[mode].reduce((count, run) => count + (Array.isArray(run.errors) ? run.errors.length : 0), 0);
    if (errorCount > 0) warnings.push(`${mode} had ${errorCount} run error(s); affected measurements are invalid.`);
  }
  const baseline = summaries.baseline; const enabled = summaries["extension-enabled"]; const diagnostics = summaries["diagnostics-enabled"];
  const loadBase = median(baseline, "cold.navigation.loadEventEnd"); const loadEnabled = median(enabled, "cold.navigation.loadEventEnd");
  if (loadBase > 0 && loadEnabled > loadBase * 1.1) warnings.push("Enabled load median is more than 10% slower than baseline.");
  if (median(enabled, "cold.paint.fcp") - median(baseline, "cold.paint.fcp") > 100) warnings.push("Enabled FCP is more than 100 ms slower than baseline.");
  if (median(enabled, "cold.paint.lcp") - median(baseline, "cold.paint.lcp") > 200) warnings.push("Enabled LCP is more than 200 ms slower than baseline.");
  if (median(enabled, "cold.paint.cls") - median(baseline, "cold.paint.cls") > 0.02) warnings.push("Enabled CLS delta exceeds 0.02.");
  if (loadEnabled > 0 && median(diagnostics, "cold.navigation.loadEventEnd") > loadEnabled * 1.25) warnings.push("Diagnostics overhead exceeds 25% versus enabled mode.");
  const reports = runs["diagnostics-enabled"].flatMap((run) => {
    const report = (run.cold as Record<string, unknown> | undefined)?.extensionDiagnostics as Record<string, unknown> | undefined;
    return report ? [report] : [];
  });
  const batches = reports.flatMap((report) => Array.isArray(report.batches) ? report.batches as Array<Record<string, unknown>> : []);
  const mutation = batches.filter((batch) => batch.trigger === "mutation").map((batch) => Number(batch.totalDuration ?? 0));
  if (percentile(mutation, 0.95) > 16.7) warnings.push("Mutation batch p95 exceeds 16.7 ms.");
  if (batches.some((batch) => Number(batch.totalDuration ?? 0) > 100)) warnings.push("At least one extension batch exceeds 100 ms.");
  if (batches.filter((batch) => batch.fullPageScan === true && batch.trigger !== "initial").length > reports.length) warnings.push("More than one full-document rescan occurred after initial load.");
  return warnings;
}

export async function buildExtensions(
  runner: typeof runCommand = runCommand,
  projectRoot = PROJECT_ROOT,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await runner("npm", ["run", "build"], {
    cwd: projectRoot,
    env: environment,
  });

  await runner("npm", ["run", "build:perf"], {
    cwd: projectRoot,
    env: {
      ...environment,
      EUC_PERFORMANCE_DIAGNOSTICS: "true",
    },
  });
}

async function startFixtureServer(): Promise<{ server: Server; origin: string }> {
  const fixtureRoot = resolve(ROOT, "performance-fixtures");
  const server = createServer(async (request, response) => {
    const requested = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const file = resolve(fixtureRoot, `.${requested === "/" ? "/static-prices.html" : requested}`);
    if (!file.startsWith(fixtureRoot) || !existsSync(file)) { response.writeHead(404).end("Not found"); return; }
    const mime = extname(file) === ".js" ? "text/javascript" : "text/html";
    response.writeHead(200, { "content-type": `${mime}; charset=utf-8`, "cache-control": "no-store" });
    response.end(await readFile(file));
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server failed to bind");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

const OBSERVER_SCRIPT = `(() => {
  globalThis.__name ??= (target) => target;
  const state = window.__EUC_AUDIT_OBSERVERS__ = { lcp: 0, cls: 0, inp: 0, longTasks: [], lastActivity: performance.now(), largeMutationAt: 0 };
  const observe = (type, callback) => { try { new PerformanceObserver(list => { callback(list.getEntries()); state.lastActivity = performance.now(); }).observe({type, buffered:true}); } catch {} };
  observe('largest-contentful-paint', entries => { const last = entries.at(-1); if (last) state.lcp = last.startTime; });
  observe('layout-shift', entries => { for (const e of entries) if (!e.hadRecentInput) state.cls += e.value; });
  observe('event', entries => { for (const e of entries) state.inp = Math.max(state.inp, e.duration || 0); });
  observe('longtask', entries => { state.longTasks.push(...entries.slice(-500).map(e => ({startTime:e.startTime,duration:e.duration}))); state.longTasks = state.longTasks.slice(-500); });
  new MutationObserver(records => { state.lastActivity = performance.now(); if (records.length > 50) state.largeMutationAt = performance.now(); }).observe(document, {subtree:true,childList:true,characterData:true,attributes:true});
})();`;

async function setExtensionSettings(context: BrowserContext, enabled: boolean): Promise<string> {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(async ({ enabledValue }) => {
    await chrome.storage.sync.set({ "euc-settings": { targetCurrency: "EUR", enabled: enabledValue, converterMode: "currencies",
      badgeStyle: "default", badgeVisibility: "always", unitSystem: "auto", targetLengthUnit: "auto",
      targetWeightUnit: "auto", targetTemperatureUnit: "auto", whitelist: [], blacklist: [] } });
  }, { enabledValue: enabled });
  return extensionId;
}

async function configureCdp(cdp: CDPSession, profile: ProfileName): Promise<void> {
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Runtime.enable");
  if (profile === "throttled") {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
  }
}

async function extensionPendingWork(cdp: CDPSession, contextIds: readonly number[]): Promise<Record<string, unknown>> {
  for (const contextId of [...contextIds].reverse()) {
    try {
      const result = await cdp.send("Runtime.evaluate", { contextId, returnByValue: true,
        expression: "globalThis.__EUC_PERF_DIAGNOSTICS__?.getPendingWork?.() ?? null" });
      if (result.result.value) return result.result.value as Record<string, unknown>;
    } catch { /* Context disappeared while the page was settling. */ }
  }
  return {};
}

async function stabilize(page: Page, cdp: CDPSession, contextIds: () => number[], quietWindowMs: number, maxWaitMs: number): Promise<Record<string, unknown>> {
  const started = Date.now(); let quietStarted = Date.now(); let previous = "";
  while (Date.now() - started < maxWaitMs) {
    const pageSnapshot = await page.evaluate(() => {
      const state = (window as unknown as { __EUC_AUDIT_OBSERVERS__?: { lastActivity: number; largeMutationAt: number } }).__EUC_AUDIT_OBSERVERS__;
      return { resources: performance.getEntriesByType("resource").length, activity: state?.lastActivity ?? 0,
        largeMutationAt: state?.largeMutationAt ?? 0 };
    });
    const snapshot = { ...pageSnapshot, pending: await extensionPendingWork(cdp, contextIds()) };
    const serialized = JSON.stringify(snapshot);
    const pending = Object.values(snapshot.pending).some(Boolean);
    if (serialized !== previous || pending) quietStarted = Date.now();
    previous = serialized;
    if (!pending && Date.now() - quietStarted >= quietWindowMs) return { stable: true, timedOut: false, waitedMs: Date.now() - started, quietWindowMs };
    await page.waitForTimeout(100);
  }
  return { stable: false, timedOut: true, waitedMs: Date.now() - started, quietWindowMs };
}

async function runScenario(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pause = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    for (let y = 0; y <= height; y += Math.max(300, innerHeight * 0.75)) { scrollTo(0, y); await pause(100); }
    scrollTo(0, 0);
    (window as unknown as { __EUC_PERF_DIAGNOSTICS__?: { markScenario(name: string): void } }).__EUC_PERF_DIAGNOSTICS__?.markScenario("scroll-complete");
  });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(150);
  }
  await page.evaluate(() => (window as unknown as { __EUC_PERF_DIAGNOSTICS__?: { markScenario(name: string): void } }).__EUC_PERF_DIAGNOSTICS__?.markScenario("resize-complete"));
}

async function collectExtensionDiagnostics(cdp: CDPSession, contextIds: readonly number[]): Promise<unknown> {
  for (const contextId of [...contextIds].reverse()) {
    try {
      const result = await cdp.send("Runtime.evaluate", { contextId, returnByValue: true, awaitPromise: true,
        expression: "globalThis.__EUC_PERF_DIAGNOSTICS__?.getDetailedReport?.() ?? null" });
      if (result.result.value) return result.result.value;
    } catch { /* The execution context may have been replaced during navigation. */ }
  }
  return null;
}

async function collectMetrics(page: Page, cdp: CDPSession, contextIds: readonly number[], stabilization: Record<string, unknown>): Promise<Record<string, unknown>> {
  const apiMetrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const observer = (window as unknown as { __EUC_AUDIT_OBSERVERS__?: { lcp: number; cls: number; inp: number; longTasks: Array<{ startTime: number; duration: number }> } }).__EUC_AUDIT_OBSERVERS__;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const elements = document.getElementsByTagName("*").length; let textNodes = 0; const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT); while (walker.nextNode()) textNodes++;
    return {
      navigation: navigation ? { navigationStart: 0, responseStart: navigation.responseStart, domContentLoaded: navigation.domContentLoadedEventEnd,
        loadEventEnd: navigation.loadEventEnd, timeToFirstByte: navigation.responseStart - navigation.requestStart,
        domInteractive: navigation.domInteractive, domComplete: navigation.domComplete } : {},
      paint: { firstPaint: paints["first-paint"], fcp: paints["first-contentful-paint"], lcp: observer?.lcp ?? 0, cls: observer?.cls ?? 0, inp: observer?.inp || null },
      longTasks: { entries: observer?.longTasks ?? [], count: observer?.longTasks.length ?? 0,
        totalDuration: observer?.longTasks.reduce((sum, item) => sum + item.duration, 0) ?? 0,
        maximumDuration: Math.max(0, ...(observer?.longTasks.map((item) => item.duration) ?? [])),
        totalBlockingTime: observer?.longTasks.reduce((sum, item) => sum + Math.max(0, item.duration - 50), 0) ?? 0 },
      memory: memory ? { ...memory } : {}, dom: { nodeCount: elements + textNodes, elementCount: elements, textNodeCount: textNodes },
      resources: { requestCount: resources.length, transferredBytes: resources.reduce((sum, item) => sum + item.transferSize, 0),
        decodedBodySize: resources.reduce((sum, item) => sum + item.decodedBodySize, 0),
        scriptCount: resources.filter((item) => item.initiatorType === "script").length,
        imageCount: resources.filter((item) => item.initiatorType === "img").length,
        fontCount: resources.filter((item) => /font/i.test(item.initiatorType) || /\.(woff2?|ttf|otf)(\?|$)/i.test(item.name)).length },
    };
  });
  const [{ metrics }, dom, extensionDiagnostics] = await Promise.all([cdp.send("Performance.getMetrics"),
    cdp.send("DOM.getDocument", { depth: -1, pierce: true }), collectExtensionDiagnostics(cdp, contextIds)]);
  return { ...apiMetrics, cdp: { source: "Chrome DevTools Protocol", metrics: Object.fromEntries(metrics.map((item) => [item.name, item.value])),
    nodeCount: countCdpNodes(dom.root as unknown as { children?: unknown[]; shadowRoots?: unknown[] }) }, extensionDiagnostics, stabilization };
}

function countCdpNodes(node: { children?: unknown[]; shadowRoots?: unknown[] }): number {
  const children = [...(node.children ?? []), ...(node.shadowRoots ?? [])] as Array<{ children?: unknown[]; shadowRoots?: unknown[] }>;
  return 1 + children.reduce((sum, child) => sum + countCdpNodes(child), 0);
}

async function launch(mode: AuditMode, userDataDirectory: string, options: CliOptions): Promise<{ context: BrowserContext; extensionId?: string }> {
  if (mode === "baseline") return { context: await chromium.launchPersistentContext(userDataDirectory, { headless: options.headless,
    channel: "chromium",
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC" }) };
  const extensionPath = resolve(ROOT, mode === "diagnostics-enabled" ? "dist-perf" : "dist");
  const context = await chromium.launchPersistentContext(userDataDirectory, { channel: "chromium", headless: options.headless,
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  return { context, extensionId: await setExtensionSettings(context, mode !== "extension-disabled") };
}

async function auditRun(mode: AuditMode, url: string, runNumber: number, warmup: boolean, options: CliOptions, artifactDirectory: string): Promise<Record<string, unknown>> {
  const userDataDirectory = resolve(artifactDirectory, "profiles", `${mode}-${runNumber}-${Date.now()}`);
  await mkdir(userDataDirectory, { recursive: true });
  let context: BrowserContext | undefined; const errors: string[] = []; const screenshots: string[] = []; let tracePath: string | undefined; let cpuProfilePath: string | undefined;
  try {
    const launched = await launch(mode, userDataDirectory, options); context = launched.context;
    await context.addInitScript({ content: OBSERVER_SCRIPT });
    if (options.trace) { tracePath = resolve(artifactDirectory, `${mode}-run-${runNumber}.zip`); await context.tracing.start({ screenshots: true, snapshots: true, sources: false }); }
    const page = context.pages()[0] ?? await context.newPage(); const cdp = await context.newCDPSession(page); await configureCdp(cdp, options.profile);
    const executionContexts = new Set<number>();
    cdp.on("Runtime.executionContextCreated", (event) => executionContexts.add(event.context.id));
    cdp.on("Runtime.executionContextDestroyed", (event) => executionContexts.delete(event.executionContextId));
    cdp.on("Runtime.executionContextsCleared", () => executionContexts.clear());
    if (options.cpuProfile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    await page.goto("about:blank");
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    const coldStabilization = await stabilize(page, cdp, () => [...executionContexts], options.quietWindowMs, options.maxWaitMs);
    if (options.manualTranslation && mode === "diagnostics-enabled" && runNumber === 1) {
      if (options.headless) throw new Error("--manual-translation requires --headful");
      await page.evaluate(() => (window as unknown as { __EUC_PERF_DIAGNOSTICS__?: { markScenario(name: string): void } }).__EUC_PERF_DIAGNOSTICS__?.markScenario("manual-translation-start"));
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      await prompt.question("Enable browser translation, wait for it to finish, then press Enter to continue: "); prompt.close();
      await page.evaluate(() => (window as unknown as { __EUC_PERF_DIAGNOSTICS__?: { markScenario(name: string): void } }).__EUC_PERF_DIAGNOSTICS__?.markScenario("manual-translation-complete"));
    }
    await runScenario(page); await stabilize(page, cdp, () => [...executionContexts], options.quietWindowMs, options.maxWaitMs);
    const cold = await collectMetrics(page, cdp, [...executionContexts], coldStabilization);
    const coldPaint = cold.paint as Record<string, number>; const extension = cold.extensionDiagnostics as { batches?: Array<{ totalDuration?: number }>; counters?: Record<string, number> } | null;
    const screenshotReasons = [coldPaint.cls > 0.1 ? "cls" : "", extension?.batches?.some((batch) => (batch.totalDuration ?? 0) > 100) ? "slow-batch" : "",
      (extension?.counters?.duplicateBadgesRemoved ?? 0) > 0 ? "duplicate-badge" : ""].filter(Boolean);
    if (options.screenshots || screenshotReasons.length) {
      const path = resolve(artifactDirectory, `${mode}-run-${runNumber}-${Date.now()}-${screenshotReasons.join("-") || "manual"}.png`);
      await page.screenshot({ path, fullPage: true }); screenshots.push(path);
    }
    await page.reload({ waitUntil: "load", timeout: 45000 });
    const warmStabilization = await stabilize(page, cdp, () => [...executionContexts], options.quietWindowMs, options.maxWaitMs);
    const warm = await collectMetrics(page, cdp, [...executionContexts], warmStabilization);
    if (options.cpuProfile) {
      const { profile } = await cdp.send("Profiler.stop"); cpuProfilePath = resolve(artifactDirectory, `${mode}-run-${runNumber}.cpuprofile`);
      await writeFile(cpuProfilePath, JSON.stringify(profile)); await cdp.send("Profiler.disable");
    }
    return { mode, url, runNumber, warmup, profile: options.profile, extensionId: launched.extensionId,
      chromiumVersion: context.browser()?.version() ?? "unknown", cold, warm, errors, screenshots, tracePath, cpuProfilePath };
  } catch (error) {
    errors.push(error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500));
    if (context) { const page = context.pages()[0]; if (page) { const path = resolve(artifactDirectory, `${mode}-run-${runNumber}-${Date.now()}-crash.png`); await page.screenshot({ path }).catch(() => undefined); screenshots.push(path); } }
    return { mode, url, runNumber, warmup, errors, screenshots, tracePath, cpuProfilePath };
  } finally {
    if (context && options.trace && tracePath) await context.tracing.stop({ path: tracePath }).catch(() => undefined);
    await context?.close().catch(() => undefined); await rm(userDataDirectory, { recursive: true, force: true });
  }
}

function comparison(left: Record<string, NumericSummary>, right: Record<string, NumericSummary>): Record<string, unknown> {
  return Object.fromEntries(SUMMARY_METRICS.map((path) => { const baseline = median(left, path); const candidate = median(right, path);
    return [path, { baselineMedian: baseline, candidateMedian: candidate, absoluteDelta: candidate - baseline,
      percentageDelta: baseline === 0 ? null : ((candidate - baseline) / baseline) * 100 }]; }));
}

function markdown(report: Record<string, unknown>): string {
  const modes = report.modes as Record<AuditMode, { summary: Record<string, NumericSummary> }>;
  const cell = (mode: AuditMode, path: string) => median(modes[mode].summary, path).toFixed(path.endsWith("cls") ? 3 : 1);
  const lines = ["# Ehinium Performance Audit", "", "## Environment", "", `- Started: ${String((report.audit as Record<string, unknown>).startedAt)}`,
    `- Chromium: ${String((report.environment as Record<string, unknown>).chromiumVersion)}`, `- OS: ${platform()} ${release()}`, "", "## Summary", "",
    "| Metric | Baseline | Extension disabled | Extension enabled | Diagnostics | Enabled delta |", "| --- | ---: | ---: | ---: | ---: | ---: |"];
  for (const [label, path] of [["Load event (ms)", "cold.navigation.loadEventEnd"], ["FCP (ms)", "cold.paint.fcp"], ["LCP (ms)", "cold.paint.lcp"],
    ["CLS", "cold.paint.cls"], ["Long tasks (ms)", "cold.longTasks.totalDuration"], ["Used JS heap (bytes)", "cold.memory.usedJSHeapSize"], ["DOM nodes", "cold.dom.nodeCount"]]) {
    const delta = median(modes["extension-enabled"].summary, path) - median(modes.baseline.summary, path);
    lines.push(`| ${label} | ${cell("baseline", path)} | ${cell("extension-disabled", path)} | ${cell("extension-enabled", path)} | ${cell("diagnostics-enabled", path)} | ${delta.toFixed(1)} |`);
  }
  const diagnosticsRuns = (modes["diagnostics-enabled"] as unknown as { runs?: Array<Record<string, unknown>> }).runs ?? [];
  const extensionReports = diagnosticsRuns.flatMap((run) => {
    const value = (run.cold as Record<string, unknown> | undefined)?.extensionDiagnostics;
    return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
  });
  const measurements = extensionReports.flatMap((item) => Array.isArray(item.measurements) ? item.measurements as Array<Record<string, unknown>> : []);
  const batches = extensionReports.flatMap((item) => Array.isArray(item.batches) ? item.batches as Array<Record<string, unknown>> : []);
  const counters = extensionReports.map((item) => item.counters as Record<string, number> | undefined).filter(Boolean) as Array<Record<string, number>>;
  const durations = (name: string) => measurements.filter((item) => item.name === name).map((item) => Number(item.duration ?? 0));
  const counterTotal = (name: string) => counters.reduce((sum, item) => sum + (item[name] ?? 0), 0);
  const mutationDurations = batches.filter((item) => item.trigger === "mutation").map((item) => Number(item.totalDuration ?? 0));
  lines.push("", "## Extension Work", "",
    `- Initial scan median: ${summarizeNumbers(durations("initial-dom-scan")).median.toFixed(1)} ms`,
    `- Initial render median: ${summarizeNumbers(durations("initial-render")).median.toFixed(1)} ms`,
    `- Mutation batch p95: ${summarizeNumbers(mutationDurations).p95.toFixed(1)} ms`,
    `- Maximum batch duration: ${Math.max(0, ...batches.map((item) => Number(item.totalDuration ?? 0))).toFixed(1)} ms`,
    `- Full-page rescans: ${counterTotal("fullDocumentRescans")}`,
    `- Parser calls: ${counterTotal("parserCalls")}`,
    `- Badges rendered: ${counterTotal("inlineBadgesInserted") + counterTotal("overlayBadgesInserted")}`,
    `- Overlay fallbacks: ${counterTotal("fallbackActivations")}`,
    "", "## Slowest Batches", "", "| Batch | Trigger | Duration (ms) | Frame budget |", "| --- | --- | ---: | --- |",
    ...[...batches].sort((left, right) => Number(right.totalDuration ?? 0) - Number(left.totalDuration ?? 0)).slice(0, 10)
      .map((item) => `| ${String(item.batchId ?? "unknown")} | ${String(item.trigger ?? "unknown")} | ${Number(item.totalDuration ?? 0).toFixed(1)} | ${String(item.frameBudget ?? "unknown")} |`),
    "", "## Regressions and Warnings", "", ...((report.warnings as string[]).length ? (report.warnings as string[]).map((item) => `- ${item}`) : ["No configured thresholds exceeded."]),
    "", "## Artifacts", "", ...((report.artifacts as string[]).map((item) => `- ${item}`)));
  return `${lines.join("\n")}\n`;
}

export async function main(): Promise<void> {
  const options = parseArgs();
  if (!options.urls.length) throw new Error("Pass --url <URL>, --urls <JSON file>, or --url fixture:<name>.");
  if (!options.skipBuild) await buildExtensions();
  const fixture = await startFixtureServer(); const startedAt = new Date(); const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const artifactDirectory = resolve(options.outputDirectory, stamp); await mkdir(artifactDirectory, { recursive: true });
  const urls = options.urls.map((url) => url.startsWith("fixture:") ? `${fixture.origin}/${url.slice("fixture:".length)}.html` : url);
  const modeRuns = Object.fromEntries(MODES.map((mode) => [mode, []])) as Record<AuditMode, Array<Record<string, unknown>>>;
  try {
    for (const mode of MODES) for (let run = 0; run <= options.runs; run++) for (const url of urls) {
      console.log(`[perf] ${mode} ${run === 0 ? "warm-up" : `run ${run}/${options.runs}`} ${url}`);
      modeRuns[mode].push(await auditRun(mode, url, run, run === 0, options, artifactDirectory));
    }
  } finally { await new Promise<void>((resolvePromise) => fixture.server.close(() => resolvePromise())); }
  const summaries = Object.fromEntries(MODES.map((mode) => [mode, summarizeRuns(modeRuns[mode])])) as Record<AuditMode, Record<string, NumericSummary>>;
  const warnings = createWarnings(summaries, modeRuns); const packageJson = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8")) as { version: string };
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const chromiumVersion = MODES.flatMap((mode) => modeRuns[mode]).map((run) => run.chromiumVersion).find((value): value is string => typeof value === "string") ?? "unknown";
  const report = redact({ schema: "ehinium-performance-audit/v1", audit: { urls, startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(),
      runsPerMode: options.runs, warmupRuns: 1, profiles: [options.profile], cacheMode: "disabled", networkProfile: options.profile === "throttled" ? "Fast 4G" : "none",
      cpuThrottlingProfile: options.profile === "throttled" ? "4x slowdown" : "none", headless: options.headless, devToolsAttached: false },
    environment: { hostname: hostname(), operatingSystem: `${platform()} ${release()}`, cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length,
      totalMemory: totalmem(), viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-US", timezone: "UTC", chromiumVersion },
    extension: { commitHash: commit, version: packageJson.version, normalBuild: "dist", diagnosticsBuild: "dist-perf",
      settings: { targetCurrency: "EUR", converterMode: "currencies", badgeVisibility: "always", unitSystem: "auto", whitelist: [], blacklist: [] } },
    modes: Object.fromEntries(MODES.map((mode) => [mode, { runs: modeRuns[mode], summary: summaries[mode] }])),
    comparisons: { enabledVsBaseline: comparison(summaries.baseline, summaries["extension-enabled"]),
      disabledVsBaseline: comparison(summaries.baseline, summaries["extension-disabled"]), diagnosticsVsEnabled: comparison(summaries["extension-enabled"], summaries["diagnostics-enabled"]) },
    warnings, artifacts: MODES.flatMap((mode) => modeRuns[mode].flatMap((run) => [
      ...(Array.isArray(run.screenshots) ? run.screenshots as string[] : []),
      ...(typeof run.tracePath === "string" ? [run.tracePath] : []),
      ...(typeof run.cpuProfilePath === "string" ? [run.cpuProfilePath] : []),
    ])) }) as Record<string, unknown>;
  const jsonPath = resolve(artifactDirectory, `performance-audit-${stamp}.json`); const markdownPath = resolve(artifactDirectory, `performance-audit-${stamp}.md`);
  report.artifacts = [jsonPath, markdownPath, ...(report.artifacts as string[])]; await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`); await writeFile(markdownPath, markdown(report));
  console.log(`[perf] JSON: ${jsonPath}\n[perf] Markdown: ${markdownPath}\n[perf] Warnings: ${warnings.length}`);
  if (options.strict && warnings.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) void main().catch((error) => { console.error(error); process.exitCode = 1; });
