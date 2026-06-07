export type GetSettingsMessage = {
  type: "GET_SETTINGS";
};

export type PingMessage = {
  type: "PING";
};

export type ExtensionMessage = GetSettingsMessage | PingMessage;
