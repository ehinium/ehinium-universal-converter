import type { UserSettings } from "../types/settings";
import { isDomainAllowed } from "./domainRules";
import { getSupportedHostname, setSiteAllowed } from "./siteControls";

const settings: UserSettings = {
  targetCurrency: "EUR",
  enabled: true,
  converterMode: "currencies",
  badgeStyle: "default",
  badgeVisibility: "always",
  unitSystem: "auto",
  targetLengthUnit: "auto",
  targetWeightUnit: "auto",
  targetTemperatureUnit: "auto",
  whitelist: [],
  blacklist: [],
};

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

const blocked = setSiteAllowed(settings, "www.amazon.com", false);
expectEqual(
  isDomainAllowed("www.amazon.com", blocked),
  false,
  "blocking current hostname prevents rendering"
);

const unblocked = setSiteAllowed(blocked, "www.amazon.com", true);
expectEqual(
  isDomainAllowed("www.amazon.com", unblocked),
  true,
  "unblocking current hostname allows rendering"
);

const parentBlocked = {
  ...settings,
  blacklist: ["amazon.com"],
};
expectEqual(
  isDomainAllowed(
    "www.amazon.com",
    setSiteAllowed(parentBlocked, "www.amazon.com", true)
  ),
  true,
  "enabling removes parent-domain blacklist entries"
);

for (const url of [
  undefined,
  "",
  "chrome://settings",
  "chrome-extension://abc/popup.html",
  "file:///tmp/example.html",
  "not a url",
]) {
  expectEqual(getSupportedHostname(url), null, `unsupported URL ${String(url)}`);
}

expectEqual(
  getSupportedHostname("https://WWW.Example.COM/path"),
  "www.example.com",
  "supported URL hostname"
);
