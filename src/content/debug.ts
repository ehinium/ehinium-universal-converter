export type DebugEvent = {
  type:
    | "match:text"
    | "match:grouped"
    | "match:unit"
    | "skip:same-currency"
    | "skip:duplicate"
    | "skip:unit-duplicate"
    | "skip:unsafe-placement"
    | "render:badge"
    | "render:unit-badge"
    | "error";
  sourceCurrency?: string;
  targetCurrency?: string;
  sourceUnit?: string;
  targetUnit?: string;
  amount?: number;
  formatted?: string;
  reason?: string;
  text?: string;
};

const DEBUG_STORAGE_KEY = "ehinium-debug";
const MAX_DEBUG_EVENTS = 500;
const debugEvents: DebugEvent[] = [];

export function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function debugLog(event: DebugEvent): void {
  if (!isDebugEnabled()) {
    return;
  }

  const storedEvent = { ...event };

  debugEvents.push(storedEvent);

  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.splice(0, debugEvents.length - MAX_DEBUG_EVENTS);
  }

  console.debug("[EUC debug]", storedEvent);
}

export function getDebugEvents(): DebugEvent[] {
  return debugEvents.map((event) => ({ ...event }));
}

export function clearDebugEvents(): void {
  debugEvents.length = 0;
}
