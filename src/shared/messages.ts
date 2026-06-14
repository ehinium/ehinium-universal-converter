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

export type ExtensionMessage =
  | GetSettingsMessage
  | PingMessage
  | ShowManualConversionMessage
  | SettingsChangedMessage;
