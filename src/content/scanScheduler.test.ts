import { createScanScheduler, type ScanRequest } from "./scanScheduler";
import type { DebugEvent } from "./debug";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

{
  let scanCount = 0;
  const scheduler = createScanScheduler({
    delayMs: 5,
    scan: async () => {
      scanCount++;
      return 0;
    },
    debugLog: () => undefined,
  });

  scheduler.schedule({ reason: "mutation", roots: [] });
  scheduler.schedule({ reason: "mutation", roots: [] });
  scheduler.schedule({ reason: "mutation", roots: [] });

  await wait(20);
  expectEqual(scanCount, 1, "many mutations schedule one scan");
}

{
  let releaseScan: () => void = () => undefined;
  let scanCount = 0;
  const scheduler = createScanScheduler({
    delayMs: 0,
    scan: async () => {
      scanCount++;

      if (scanCount === 1) {
        await new Promise<void>((resolve) => {
          releaseScan = resolve;
        });
      }

      return 0;
    },
    debugLog: () => undefined,
  });

  scheduler.schedule({ reason: "mutation", roots: [] });
  await wait(5);
  scheduler.schedule({ reason: "mutation", roots: [] });
  scheduler.schedule({ reason: "mutation", roots: [] });

  releaseScan();
  await wait(5);
  expectEqual(scanCount, 2, "active scan schedules one follow-up scan");
}

{
  const requests: ScanRequest[] = [];
  const scheduler = createScanScheduler({
    delayMs: 0,
    scan: async (nextRequest) => {
      requests.push(nextRequest);
      return 0;
    },
    debugLog: () => undefined,
  });

  await scheduler.flush({ reason: "settings", roots: null });
  expectEqual(requests[0]?.reason, "settings", "settings change scan reason");
  expectEqual(requests[0]?.roots, null, "settings change forces full rescan");
}

{
  const events: DebugEvent[] = [];
  const scheduler = createScanScheduler({
    delayMs: 0,
    scan: async () => 7,
    debugLog: (event) => {
      events.push(event);
    },
    now: () => 10,
  });

  await scheduler.flush({ reason: "initial", roots: [] });
  expectEqual(
    events.some((event) => event.type === "scan:start"),
    true,
    "scan start debug event"
  );
  expectEqual(
    events.some(
      (event) => event.type === "scan:end" && event.scannedNodeCount === 7
    ),
    true,
    "scan end debug event"
  );
}
