import {
  fetchEhiniumIranianRate,
  type FetchEhiniumIranianRateOptions,
} from "../services/ehiniumIranianRates";
import {
  getIranianBridgeRate,
  type GetIranianBridgeRateOptions,
} from "../services/iranianRateCache";
import type {
  GetIranianBridgeRateMessage,
  GetIranianBridgeRateResponse,
} from "../shared/messages";
import type { IranianBridgeRate } from "../types/rates";

type IranianBridgeHandlerDependencies = {
  getIranianBridgeRate: (
    options: GetIranianBridgeRateOptions
  ) => Promise<{
    rate: IranianBridgeRate;
    freshness: "fresh" | "stale";
    source: "memory" | "storage" | "network";
    refreshError?: string;
  }>;
  fetchEhiniumIranianRate: (
    options: FetchEhiniumIranianRateOptions
  ) => Promise<IranianBridgeRate>;
};

export type CreateIranianBridgeMessageHandlerOptions = {
  apiUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  dependencies?: Partial<IranianBridgeHandlerDependencies>;
};

export type IranianBridgeMessageHandler = (
  message: unknown
) => Promise<GetIranianBridgeRateResponse | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIranianBridgeMessage(
  value: unknown
): value is GetIranianBridgeRateMessage {
  return isRecord(value) && value.type === "GET_IRANIAN_BRIDGE_RATE";
}

function isMissingConfiguration(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

export function createIranianBridgeMessageHandler(
  options: CreateIranianBridgeMessageHandlerOptions
): IranianBridgeMessageHandler {
  const loadBridgeRate =
    options.dependencies?.getIranianBridgeRate ?? getIranianBridgeRate;
  const fetchBridgeRate =
    options.dependencies?.fetchEhiniumIranianRate ?? fetchEhiniumIranianRate;

  return async (message) => {
    if (!isIranianBridgeMessage(message)) return undefined;

    if (
      isMissingConfiguration(options.apiUrl) ||
      isMissingConfiguration(options.token)
    ) {
      return {
        ok: false,
        error: "Iranian rates configuration is missing",
      };
    }

    try {
      const result = await loadBridgeRate({
        forceRefresh:
          typeof message.forceRefresh === "boolean"
            ? message.forceRefresh
            : undefined,
        fetchRate: () =>
          fetchBridgeRate({
            apiUrl: options.apiUrl,
            token: options.token,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          }),
      });

      return {
        ok: true,
        rate: result.rate,
        freshness: result.freshness,
        source: result.source,
        ...(result.refreshError !== undefined
          ? { refreshError: result.refreshError }
          : {}),
      };
    } catch {
      return {
        ok: false,
        error: "Iranian rates are unavailable",
      };
    }
  };
}
