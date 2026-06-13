import { defaultSettings } from "../utils/defaultSettings";

if (!defaultSettings.enabled) {
  throw new Error("Expected conversions to be enabled by default");
}

if (defaultSettings.converterMode !== "currencies") {
  throw new Error(
    `Expected default converter mode to be currencies, received ${defaultSettings.converterMode}`
  );
}

if (defaultSettings.badgeStyle !== "default") {
  throw new Error(
    `Expected default badge style to be default, received ${defaultSettings.badgeStyle}`
  );
}
