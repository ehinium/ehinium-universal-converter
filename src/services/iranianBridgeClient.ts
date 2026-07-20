import type {
  GetIranianBridgeRateMessage,
  GetIranianBridgeRateSuccessResponse,
} from "../shared/messages";
import type { IranianBridgeRate } from "../types/rates";

export type RequestIranianBridgeRateOptions = {
  forceRefresh?: boolean;
  sendMessage?: typeof chrome.runtime.sendMessage;
};

export type IranianBridgeClientResult = {
  rate: IranianBridgeRate;
  freshness: "fresh" | "stale";
  source: "memory" | "storage" | "network";
  refreshError?: string;
};

export type IranianBridgeClientErrorCode = "misconfigured" | "unavailable";

export class IranianBridgeClientError extends Error {
  readonly code: IranianBridgeClientErrorCode;

  constructor(code: IranianBridgeClientErrorCode) {
    super(
      code === "misconfigured"
        ? "Iranian rates configuration unavailable"
        : IRANIAN_RATES_UNAVAILABLE
    );
    this.name = "IranianBridgeClientError";
    this.code = code;
  }
}

const IRANIAN_RATES_UNAVAILABLE = "Iranian rates are unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIranianBridgeRate(value: unknown): value is IranianBridgeRate {
  return (
    isRecord(value) &&
    value.unit === "IRT" &&
    value.provider === "ehinium" &&
    typeof value.usdSellIrt === "number" &&
    Number.isFinite(value.usdSellIrt) &&
    value.usdSellIrt > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0 &&
    (value.sourceUpdatedAt === null ||
      (typeof value.sourceUpdatedAt === "string" &&
        value.sourceUpdatedAt.trim().length > 0))
  );
}

function isValidSuccessResponse(
  value: unknown
): value is GetIranianBridgeRateSuccessResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    isValidIranianBridgeRate(value.rate) &&
    (value.freshness === "fresh" || value.freshness === "stale") &&
    (value.source === "memory" ||
      value.source === "storage" ||
      value.source === "network") &&
    (value.refreshError === undefined ||
      typeof value.refreshError === "string")
  );
}

function getRuntimeSendMessage(): typeof chrome.runtime.sendMessage {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== "function"
  ) {
    throw new IranianBridgeClientError("misconfigured");
  }

  return chrome.runtime.sendMessage;
}

export async function requestIranianBridgeRateDetails(
  options: RequestIranianBridgeRateOptions = {}
): Promise<IranianBridgeClientResult> {
  const message: GetIranianBridgeRateMessage = {
    type: "GET_IRANIAN_BRIDGE_RATE",
    ...(options.forceRefresh === undefined
      ? {}
      : { forceRefresh: options.forceRefresh }),
  };

  let sendMessage: typeof chrome.runtime.sendMessage;
  try {
    sendMessage = options.sendMessage ?? getRuntimeSendMessage();
  } catch (error) {
    if (error instanceof IranianBridgeClientError) throw error;
    throw new IranianBridgeClientError("misconfigured");
  }

  try {
    const response: unknown = await sendMessage(message);

    if (!isValidSuccessResponse(response)) {
      if (
        isRecord(response) &&
        response.ok === false &&
        response.error === "Iranian rates configuration is missing"
      ) {
        throw new IranianBridgeClientError("misconfigured");
      }
      throw new IranianBridgeClientError("unavailable");
    }

    const safeRate: IranianBridgeRate = {
      unit: "IRT",
      usdSellIrt: response.rate.usdSellIrt,
      updatedAt: response.rate.updatedAt,
      sourceUpdatedAt: response.rate.sourceUpdatedAt,
      provider: "ehinium",
    };

    return {
      rate: safeRate,
      freshness: response.freshness,
      source: response.source,
      ...(response.refreshError === undefined
        ? {}
        : { refreshError: "Iranian rates refresh failed" }),
    };
  } catch (error) {
    if (error instanceof IranianBridgeClientError) throw error;
    throw new IranianBridgeClientError("unavailable");
  }
}

export async function requestIranianBridgeRate(
  options: RequestIranianBridgeRateOptions = {}
): Promise<IranianBridgeRate> {
  try {
    return (await requestIranianBridgeRateDetails(options)).rate;
  } catch {
    throw new Error(IRANIAN_RATES_UNAVAILABLE);
  }
}
