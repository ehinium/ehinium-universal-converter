import type { DebugEvent } from "./debug";

export type ScanReason = "initial" | "mutation" | "settings";

export type ScanRequest = {
  reason: ScanReason;
  roots: Node[] | null;
};

export type ScanScheduler = {
  schedule: (request: ScanRequest) => void;
  flush: (request: ScanRequest) => Promise<void>;
  cancel: () => void;
  getState: () => {
    scanScheduled: boolean;
    scanInProgress: boolean;
    rescanRequested: boolean;
  };
};

type ScanSchedulerOptions = {
  delayMs: number;
  scan: (request: ScanRequest) => Promise<number>;
  debugLog: (event: DebugEvent) => void;
  now?: () => number;
};

function mergeRoots(
  currentRoots: Node[] | null,
  nextRoots: Node[] | null
): Node[] | null {
  if (currentRoots === null || nextRoots === null) {
    return null;
  }

  return [...new Set([...currentRoots, ...nextRoots])];
}

export function createScanScheduler({
  delayMs,
  scan,
  debugLog,
  now = () => performance.now(),
}: ScanSchedulerOptions): ScanScheduler {
  let scanScheduled = false;
  let scanInProgress = false;
  let rescanRequested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingRequest: ScanRequest | null = null;

  function getState() {
    return { scanScheduled, scanInProgress, rescanRequested };
  }

  function setPendingRequest(request: ScanRequest): void {
    pendingRequest = pendingRequest
      ? {
          reason: request.reason,
          roots: mergeRoots(pendingRequest.roots, request.roots),
        }
      : { ...request };
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function runPending(): Promise<void> {
    clearTimer();
    scanScheduled = false;

    const request = pendingRequest;
    pendingRequest = null;

    if (!request) {
      debugLog({
        type: "scan:skipped",
        reason: "No pending scan request",
      });
      return;
    }

    if (scanInProgress) {
      rescanRequested = true;
      setPendingRequest(request);
      debugLog({
        type: "scan:rescheduled",
        reason: "Scan already in progress",
      });
      return;
    }

    scanInProgress = true;
    const startedAt = now();

    debugLog({
      type: "scan:start",
      reason: request.reason,
    });

    let scannedNodeCount = 0;

    try {
      scannedNodeCount = await scan(request);
    } finally {
      const duration = Math.max(0, now() - startedAt);

      scanInProgress = false;
      debugLog({
        type: "scan:end",
        reason: request.reason,
        scannedNodeCount,
        duration,
      });

      if (rescanRequested && pendingRequest) {
        rescanRequested = false;
        debugLog({
          type: "scan:rescheduled",
          reason: "Follow-up scan requested",
        });
        await runPending();
      } else {
        rescanRequested = false;
      }
    }
  }

  function schedule(request: ScanRequest): void {
    setPendingRequest(request);

    if (scanInProgress) {
      rescanRequested = true;
      debugLog({
        type: "scan:rescheduled",
        reason: request.reason,
      });
      return;
    }

    if (scanScheduled) {
      debugLog({
        type: "scan:scheduled",
        reason: request.reason,
      });
      return;
    }

    scanScheduled = true;
    debugLog({
      type: "scan:scheduled",
      reason: request.reason,
    });
    timer = setTimeout(() => {
      void runPending();
    }, delayMs);
  }

  async function flush(request: ScanRequest): Promise<void> {
    setPendingRequest(request);
    await runPending();
  }

  function cancel(): void {
    clearTimer();
    scanScheduled = false;
    scanInProgress = false;
    rescanRequested = false;
    pendingRequest = null;
  }

  return {
    schedule,
    flush,
    cancel,
    getState,
  };
}
