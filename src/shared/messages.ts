import type { IranianBridgeRate } from "../types/rates";

export type GetSettingsMessage = {
  type: "GET_SETTINGS";
};

export type PingMessage = {
  type: "PING";
};

export type ShowManualConversionMessage = {
  type: "SHOW_MANUAL_CONVERSION";
  formatted: string;
};

export type SettingsChangedMessage = {
  type: "settings:changed";
};

export type GetIranianBridgeRateMessage = {
  type: "GET_IRANIAN_BRIDGE_RATE";
  forceRefresh?: boolean;
};

export type GetIranianBridgeRateSuccessResponse = {
  ok: true;
  rate: IranianBridgeRate;
  freshness: "fresh" | "stale";
  source: "memory" | "storage" | "network";
  refreshError?: string;
};

export type GetIranianBridgeRateFailureResponse = {
  ok: false;
  error: string;
};

export type GetIranianBridgeRateResponse =
  | GetIranianBridgeRateSuccessResponse
  | GetIranianBridgeRateFailureResponse;

export type CapturePageDiagnosticsMessage = {
  type: "diagnostics:capture-page";
};

export type StartElementPickerMessage = {
  type: "diagnostics:start-picker";
};

export type GetPageDiagnosticsMessage = {
  type: "diagnostics:get-report";
};

export type ClearPageDiagnosticsMessage = {
  type: "diagnostics:clear";
};

export type DiagnosticsMessage =
  | CapturePageDiagnosticsMessage
  | StartElementPickerMessage
  | GetPageDiagnosticsMessage
  | ClearPageDiagnosticsMessage;

export type ExtensionMessage =
  | GetSettingsMessage
  | PingMessage
  | ShowManualConversionMessage
  | SettingsChangedMessage
  | GetIranianBridgeRateMessage
  | DiagnosticsMessage;
