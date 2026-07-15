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
  | DiagnosticsMessage;
