import { defaultSettings } from "../utils/defaultSettings";

if (defaultSettings.converterMode !== "currencies") {
  throw new Error(
    `Expected default converter mode to be currencies, received ${defaultSettings.converterMode}`
  );
}
