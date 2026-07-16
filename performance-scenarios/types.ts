import type { Page } from "playwright";
import type { AuditWorkloadContract, WorkloadObserved } from "../scripts/performance-workload";

export type ScenarioAuditMode = "baseline" | "extension-disabled" | "extension-enabled" | "diagnostics-enabled";
export type ScenarioStep = {
  name: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
  details: unknown;
  screenshotPath: string | null;
  error: string | null;
};

export type DiagnosticsBridge = {
  getSnapshot(): Promise<Record<string, unknown>>;
  markScenario(name: string): Promise<void>;
  getPendingWork(): Promise<Record<string, unknown>>;
};

export type PerformanceScenarioContext = {
  page: Page;
  mode: ScenarioAuditMode;
  headless: boolean;
  runNumber: number;
  cycles: number;
  forceGcBetweenCycles: boolean;
  diagnostics: DiagnosticsBridge;
  recordStep<T>(name: string, action: () => Promise<T>, details?: unknown, optional?: boolean): Promise<T | null>;
  waitForExtensionIdle(options?: { quietWindowMs?: number; timeoutMs?: number }): Promise<void>;
  waitForWorkload(condition: Partial<WorkloadObserved>, timeoutMs?: number): Promise<WorkloadObserved>;
  captureWorkloadSnapshot(name: string): Promise<WorkloadObserved>;
  captureScreenshot(name: string): Promise<string>;
  manualCheckpoint(instruction: string): Promise<string>;
};

export type PerformanceScenario = {
  id: string;
  description: string;
  supportedUrlPatterns?: RegExp[];
  workloadContract: AuditWorkloadContract;
  beforeNavigation?(context: PerformanceScenarioContext): Promise<void>;
  afterNavigation?(context: PerformanceScenarioContext): Promise<void>;
  run(context: PerformanceScenarioContext): Promise<void>;
  cleanup?(context: PerformanceScenarioContext): Promise<void>;
};
