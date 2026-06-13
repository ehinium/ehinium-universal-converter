import type { UserSettings } from "../types/settings";
import { isDomainAllowed } from "./domainRules";

const baseSettings: UserSettings = {
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

function expect(value: boolean, expected: boolean, description: string): void {
  if (value !== expected) {
    throw new Error(
      `${description}: expected ${String(expected)}, received ${String(value)}`
    );
  }
}

expect(
  isDomainAllowed("example.com", baseSettings),
  true,
  "empty whitelist allows domains"
);

const whitelistedSettings = {
  ...baseSettings,
  whitelist: ["amazon.com"],
};

expect(
  isDomainAllowed("amazon.com", whitelistedSettings),
  true,
  "whitelist allows exact domains"
);
expect(
  isDomainAllowed("www.amazon.com", whitelistedSettings),
  true,
  "whitelist allows subdomains"
);
expect(
  isDomainAllowed("m.amazon.com", whitelistedSettings),
  true,
  "whitelist allows nested subdomains"
);
expect(
  isDomainAllowed("notamazon.com", whitelistedSettings),
  false,
  "whitelist rejects domain suffix lookalikes"
);
expect(
  isDomainAllowed("example.com", whitelistedSettings),
  false,
  "whitelist rejects unmatched domains"
);

const blacklistedSettings = {
  ...baseSettings,
  whitelist: ["amazon.com"],
  blacklist: ["www.amazon.com"],
};

expect(
  isDomainAllowed("www.amazon.com", blacklistedSettings),
  false,
  "blacklist overrides whitelist"
);
expect(
  isDomainAllowed("checkout.www.amazon.com", blacklistedSettings),
  false,
  "blacklist blocks subdomains"
);

expect(
  isDomainAllowed("WWW.AMAZON.COM.", whitelistedSettings),
  true,
  "domain matching is normalized"
);
