import type { UserSettings } from "../types/settings";
import { isDomainAllowed } from "./domainRules";

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+|\.+$/gu, "");
}

function domainMatchesHostname(hostname: string, domain: string): boolean {
  const normalizedDomain = normalizeDomain(domain);

  return (
    normalizedDomain.length > 0 &&
    (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`))
  );
}

export function getSupportedHostname(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !parsed.hostname
    ) {
      return null;
    }

    return normalizeDomain(parsed.hostname);
  } catch {
    return null;
  }
}

export async function getActiveTabHostname(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    return getSupportedHostname(tab?.url);
  } catch {
    return null;
  }
}

export function setSiteAllowed(
  settings: UserSettings,
  hostname: string,
  allowed: boolean
): UserSettings {
  const normalizedHostname = normalizeDomain(hostname);

  if (!normalizedHostname) {
    return settings;
  }

  if (!allowed) {
    const blacklist = settings.blacklist.some(
      (domain) => normalizeDomain(domain) === normalizedHostname
    )
      ? settings.blacklist
      : [...settings.blacklist, normalizedHostname];

    return { ...settings, blacklist };
  }

  const blacklist = settings.blacklist.filter(
    (domain) => !domainMatchesHostname(normalizedHostname, domain)
  );
  const withoutBlockingEntries = { ...settings, blacklist };

  if (
    withoutBlockingEntries.whitelist.length > 0 &&
    !isDomainAllowed(normalizedHostname, withoutBlockingEntries)
  ) {
    return {
      ...withoutBlockingEntries,
      whitelist: [...withoutBlockingEntries.whitelist, normalizedHostname],
    };
  }

  return withoutBlockingEntries;
}
