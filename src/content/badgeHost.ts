import type { BadgeStyle } from "../types/settings";
import { registerHoverTarget } from "./hoverRegistry";
import { hideTooltip, showTooltip } from "./tooltip";

export type BadgeEncapsulationDiagnostic = {
  hostSelector: string;
  protectedHost: boolean;
  translateAttribute: string | null;
  notranslateClassPresent: boolean;
  shadowRootPresent: boolean;
  shadowMode: "closed";
  lightDomChildCount: number;
  visibleTextInLightDom: boolean;
  legacyBadgeMigrated: boolean;
  foreignLightDomContaminationRemoved: boolean;
};

export type TranslationProtectionDiagnostic = {
  hostSelector: string;
  translatorMutationInsideHostDetected: boolean;
  foreignWrapperCount: number;
  authoritativeTextSource: "badge-controller";
  scannerExcluded: true;
  duplicateVisibleTextPrevented: boolean;
  warnings: string[];
};

type BadgeHostState = {
  shadowRoot: ShadowRoot;
  visibleBadge: HTMLElement;
  value: string;
  copyValue: string;
  ariaLabel: string;
  hoverContent: string;
  badgeStyle: BadgeStyle;
  legacyBadgeMigrated: boolean;
  contaminationRemoved: boolean;
  translatorMutationDetected: boolean;
  foreignWrapperCount: number;
  authoritativeCopyUsed: boolean;
  warnings: string[];
};

type LegacyAuthority = {
  value: string;
  ariaLabel: string;
  hoverContent: string;
  badgeStyle: BadgeStyle;
};

const controllers = new WeakMap<HTMLElement, BadgeHostState>();
const legacyAuthorities = new WeakMap<HTMLElement, LegacyAuthority>();
const protectedHosts = new Set<HTMLElement>();
const HOST_SELECTOR = '[data-euc-badge-host="true"]';
const COPY_FEEDBACK_DURATION_MS = 900;
const copyFeedbackTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const SHADOW_STYLE = `
:host {
  display: inline-block;
  vertical-align: baseline;
  contain: style;
  white-space: nowrap;
  line-height: normal;
}
[data-euc-shadow-badge="true"] {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--euc-badge-background, rgba(17, 24, 39, 0.08));
  color: var(--euc-badge-color, rgb(17, 24, 39));
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  vertical-align: baseline;
  text-decoration: none;
  direction: inherit;
  transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
}
:host([data-ehinium-badge-style="compact"]) [data-euc-shadow-badge="true"] {
  padding: 1px 4px;
  font-size: 10px;
}
:host([data-ehinium-badge-style="minimal"]) [data-euc-shadow-badge="true"] {
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: var(--euc-badge-color, rgba(17, 24, 39, 0.68));
  font-weight: 500;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}
:host(:focus-visible) [data-euc-shadow-badge="true"] {
  outline: 2px solid currentColor;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.75);
}
`;

function selector(host: HTMLElement): string {
  if (host.id) return `#${host.id}`;
  return `${host.tagName.toLowerCase()}[data-euc-badge-host="true"]`;
}

function applyHostInvariant(host: HTMLElement, badgeStyle: BadgeStyle): void {
  host.setAttribute("data-euc-badge-host", "true");
  host.setAttribute("data-euc-owned", "true");
  host.setAttribute("data-euc-badge", "true");
  host.setAttribute("data-ehinium-converted", "true");
  host.setAttribute("translate", "no");
  host.setAttribute("data-ehinium-badge-style", badgeStyle);
  host.classList.add("ehinium-converter-host", "notranslate");
  host.style.display = "inline-block";
  host.style.verticalAlign = "baseline";
  host.style.marginLeft = badgeStyle === "compact" ? "4px" : "6px";
  host.style.marginInlineStart = badgeStyle === "compact" ? "4px" : "6px";
  host.style.whiteSpace = "nowrap";
  host.style.flexShrink = "0";
  host.style.textDecoration = "none";
  host.style.pointerEvents = "auto";
  host.style.cursor = "pointer";
  host.style.position = "relative";
  host.style.zIndex = "auto";
}

function keyboardActivation(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

async function copyAuthoritativeValue(host: HTMLElement, state: BadgeHostState): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText || !state.copyValue) return;
    await navigator.clipboard.writeText(state.copyValue);
    state.authoritativeCopyUsed = true;
    const existing = copyFeedbackTimers.get(host);
    if (existing !== undefined) clearTimeout(existing);
    state.visibleBadge.textContent = "Copied";
    host.setAttribute("aria-label", `Copied. ${state.ariaLabel}`);
    const timer = setTimeout(() => {
      state.visibleBadge.textContent = state.value;
      host.setAttribute("aria-label", state.ariaLabel);
      copyFeedbackTimers.delete(host);
    }, COPY_FEEDBACK_DURATION_MS);
    copyFeedbackTimers.set(host, timer);
  } catch {
    // Clipboard access can be unavailable or denied on some pages.
  }
}

function installHostInteraction(host: HTMLElement, state: BadgeHostState): void {
  host.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void copyAuthoritativeValue(host, state);
  });
  host.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  host.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  host.addEventListener("keydown", (event) => {
    if (!keyboardActivation(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void copyAuthoritativeValue(host, state);
  });
  host.addEventListener("focus", () => {
    const bounds = host.getBoundingClientRect();
    showTooltip(bounds.left, bounds.bottom, state.hoverContent);
  });
  host.addEventListener("blur", hideTooltip);
  registerHoverTarget(host, state.hoverContent);
}

function attachController(
  host: HTMLElement,
  value: string,
  ariaLabel: string,
  hoverContent: string,
  badgeStyle: BadgeStyle,
  legacyBadgeMigrated: boolean
): BadgeHostState | null {
  if (controllers.has(host)) return controllers.get(host)!;
  if (host.shadowRoot) return null;
  host.replaceChildren();
  applyHostInvariant(host, badgeStyle);
  let shadowRoot: ShadowRoot;
  try {
    shadowRoot = host.attachShadow({ mode: "closed" });
  } catch {
    return null;
  }
  const style = host.ownerDocument.createElement("style");
  style.textContent = SHADOW_STYLE;
  const visibleBadge = host.ownerDocument.createElement("span");
  visibleBadge.setAttribute("data-euc-shadow-badge", "true");
  visibleBadge.textContent = value;
  shadowRoot.append(style, visibleBadge);
  const state: BadgeHostState = {
    shadowRoot, visibleBadge, value, copyValue: value, ariaLabel, hoverContent, badgeStyle,
    legacyBadgeMigrated, contaminationRemoved: false, translatorMutationDetected: false,
    foreignWrapperCount: 0,
    authoritativeCopyUsed: false,
    warnings: [legacyBadgeMigrated ? "Legacy light-DOM badge migrated" : "Badge text rendered inside shadow root"],
  };
  controllers.set(host, state);
  protectedHosts.add(host);
  host.setAttribute("aria-label", ariaLabel);
  host.dataset.ehiniumAriaLabel = ariaLabel;
  host.dataset.eucBadgeValue = value;
  installHostInteraction(host, state);
  return state;
}

export function createProtectedBadgeHost(
  value: string,
  ariaLabel: string,
  hoverContent: string,
  badgeStyle: BadgeStyle
): HTMLElement {
  const host = document.createElement("span");
  if (!attachController(host, value, ariaLabel, hoverContent, badgeStyle, false)) {
    throw new Error("Unable to create protected badge host");
  }
  return host;
}

export function cloneProtectedBadgeHost(source: HTMLElement): HTMLElement {
  const sourceState = controllers.get(source);
  if (!sourceState) throw new Error("Cannot clone an unprotected badge host");
  const clone = createProtectedBadgeHost(
    sourceState.value, sourceState.ariaLabel, sourceState.hoverContent, sourceState.badgeStyle
  );
  for (const attribute of source.getAttributeNames()) {
    if (attribute === "class" || attribute === "style") continue;
    clone.setAttribute(attribute, source.getAttribute(attribute) ?? "");
  }
  clone.className = source.className;
  clone.style.cssText = source.style.cssText;
  applyHostInvariant(clone, sourceState.badgeStyle);
  return clone;
}

export function getBadgeVisibleText(host: HTMLElement | null | undefined): string {
  return host ? controllers.get(host)?.visibleBadge.textContent ?? "" : "";
}

export function setBadgeVisibleText(host: HTMLElement, value: string): void {
  const state = controllers.get(host);
  if (!state) return;
  state.visibleBadge.textContent = value;
}

export function setBadgeAriaLabel(host: HTMLElement, value: string): void {
  const state = controllers.get(host);
  if (!state) return;
  state.ariaLabel = value;
  host.dataset.ehiniumAriaLabel = value;
  host.setAttribute("aria-label", value);
}

export function getBadgeCopyValue(host: HTMLElement): string {
  return controllers.get(host)?.copyValue ?? "";
}

export function getBadgeHoverContent(host: HTMLElement): string {
  return controllers.get(host)?.hoverContent ?? "";
}

export function getBadgeShadowStyleText(host: HTMLElement): string {
  return controllers.has(host) ? SHADOW_STYLE : "";
}

export function setBadgeColorVariables(host: HTMLElement, color: string, background: string | null): void {
  host.style.color = color;
  host.style.setProperty("--euc-badge-color", color);
  if (background !== null) host.style.setProperty("--euc-badge-background", background);
}

export function isProtectedBadgeHost(host: Element | null): host is HTMLElement {
  return host instanceof HTMLElement && controllers.has(host);
}

export function sanitizeProtectedBadgeHost(host: HTMLElement): boolean {
  const state = controllers.get(host);
  if (!state || host.childNodes.length === 0) return false;
  const wrappers = [...host.childNodes].filter((node) => node instanceof Element).length;
  host.replaceChildren();
  state.contaminationRemoved = true;
  state.translatorMutationDetected = true;
  state.foreignWrapperCount += wrappers;
  if (!state.warnings.includes("Foreign light-DOM badge content removed")) {
    state.warnings.push("Foreign light-DOM badge content removed");
  }
  return true;
}

export function handleBadgeHostMutations(mutations: readonly MutationRecord[]): void {
  const affected = new Set<HTMLElement>();
  for (const mutation of mutations) {
    const target = mutation.target instanceof Element
      ? mutation.target.closest<HTMLElement>(HOST_SELECTOR)
      : mutation.target.parentElement?.closest<HTMLElement>(HOST_SELECTOR);
    if (target) affected.add(target);
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        if (node.matches(HOST_SELECTOR)) affected.add(node as HTMLElement);
        const owner = node.closest<HTMLElement>(HOST_SELECTOR);
        if (owner) affected.add(owner);
      }
    }
  }
  for (const host of affected) sanitizeProtectedBadgeHost(host);
}

export function registerLegacyBadgeAuthoritativeState(
  host: HTMLElement,
  value: string,
  ariaLabel: string,
  hoverContent: string,
  badgeStyle: BadgeStyle = "default"
): void {
  legacyAuthorities.set(host, { value, ariaLabel, hoverContent, badgeStyle });
}

export function reconcileBadgeHosts(root: ParentNode = document): void {
  const badges: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches('[data-ehinium-converted]')) badges.push(root);
  badges.push(...root.querySelectorAll<HTMLElement>('[data-ehinium-converted]'));
  for (const host of badges) {
    if (controllers.has(host)) {
      sanitizeProtectedBadgeHost(host);
      continue;
    }
    const authority = legacyAuthorities.get(host);
    if (!authority) {
      host.remove();
      continue;
    }
    if (!attachController(host, authority.value, authority.ariaLabel, authority.hoverContent, authority.badgeStyle, true)) {
      host.remove();
    }
  }
}

export function getBadgeEncapsulationDiagnostics(): BadgeEncapsulationDiagnostic[] {
  return [...protectedHosts].filter((host) => host.isConnected).map((host) => {
    const state = controllers.get(host)!;
    return {
      hostSelector: selector(host), protectedHost: true,
      translateAttribute: host.getAttribute("translate"),
      notranslateClassPresent: host.classList.contains("notranslate"),
      shadowRootPresent: !!state.shadowRoot, shadowMode: "closed",
      lightDomChildCount: host.childNodes.length,
      visibleTextInLightDom: (host.textContent ?? "").trim().length > 0,
      legacyBadgeMigrated: state.legacyBadgeMigrated,
      foreignLightDomContaminationRemoved: state.contaminationRemoved,
    };
  });
}

export function getTranslationProtectionDiagnostics(): TranslationProtectionDiagnostic[] {
  return [...protectedHosts].filter((host) => host.isConnected).map((host) => {
    const state = controllers.get(host)!;
    return {
      hostSelector: selector(host), translatorMutationInsideHostDetected: state.translatorMutationDetected,
      foreignWrapperCount: state.foreignWrapperCount,
      authoritativeTextSource: "badge-controller", scannerExcluded: true,
      duplicateVisibleTextPrevented: host.childNodes.length === 0,
      warnings: [
        ...state.warnings,
        ...(state.authoritativeCopyUsed ? ["Authoritative copy value used"] : []),
        ...(state.translatorMutationDetected ? ["Extension-owned translation mutation ignored"] : []),
      ],
    };
  });
}

export function forgetBadgeHost(host: HTMLElement): void {
  protectedHosts.delete(host);
  controllers.delete(host);
  legacyAuthorities.delete(host);
}
