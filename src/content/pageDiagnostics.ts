import { fiatCurrencies } from "../data/currencies";
import { getExchangeRates } from "../services/rates";
import type {
  AncestorDiagnostic,
  DiagnosticEvent,
  DiagnosticTextFragment,
  PageDiagnosticReport,
  PriceLikeElementDiagnostic,
  SelectedElementDiagnostic,
  TextNodeDiagnostic,
  MatchPipelineDiagnostic,
} from "../types/diagnostics";
import type { UserSettings } from "../types/settings";
import { parseCurrencies } from "../utils/currencyParser";
import { getContentExclusionReason } from "./domExclusions";
import {
  getTextNodeScanExclusion,
  getTextNodeScanExclusionReason,
} from "./domScanner";
import {
  getCurrencyPlacementSkipReason,
  getCurrencyTextNodeRenderSkipReason,
} from "./domRenderer";
import { getDebugEvents } from "./debug";
import { findPriceAnchor, selectPriceAnchor } from "./priceAnchor";
import { collectTextNodesForScan } from "./scanRoots";
import {
  collectCurrencyDomMatches,
  collectSourceTextFragments,
} from "./currencyDomMatches";
import { getDuplicateDecision } from "./currencyMatchState";
import {
  clearMutationBatchDiagnostics,
  getMutationBatchDiagnostics,
} from "./observer";
import {
  getBadgeHostCensusDiagnostic,
  getBadgeHostReconciliationDiagnostics,
} from "./badgeHostRegistry";
import { getBadgeVisibilityDiagnostics } from "./badgeVisibility";
import { getTranslationWrapperDiagnostic } from "./translationLineage";
import {
  getOverlayPlacementDiagnostics,
  getOverlayPlacementGroupDiagnostics,
  getRenderLifecycleDiagnostics,
} from "./badgeLifecycle";
import {
  getCandidateDiscoveryDiagnostics,
  getCanonicalizationDiagnostics,
  getVisualSourceReconciliationDiagnostics,
} from "./priceCandidatePipeline";
import {
  getBadgeEncapsulationDiagnostics,
  getBadgeVisibleText,
  getTranslationProtectionDiagnostics,
} from "./badgeHost";

const MAX_TEXT_NODES = 2500;
const MAX_PRICE_LIKE_ELEMENTS = 300;
const MAX_ELEMENTS_INSPECTED = 10000;
const MAX_ANCESTORS = 8;
const MAX_ELEMENT_TEXT = 500;
const MAX_FRAGMENT_TEXT = 300;
const PICKER_ATTRIBUTE = "data-ehinium-diagnostics-picker";

let latestReport: PageDiagnosticReport | null = null;
let stopActivePicker: (() => void) | null = null;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const currencyIdentifierRegex = new RegExp(
  `(?:${[
    ...new Set(fiatCurrencies.flatMap((currency) => [currency.code, ...currency.symbols])),
  ]
    .filter((identifier) => identifier.length > 1 || !/^[\p{L}\p{N}]$/u.test(identifier))
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join("|")})`,
  "iu"
);

function truncate(value: string, maximum = MAX_FRAGMENT_TEXT): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum)}…`;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/gu, (character) => `\\${character}`);
}

export function getDiagnosticSelector(element: Element): string {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  for (const attribute of ["data-testid", "data-test-id", "itemprop", "aria-label"]) {
    const value = element.getAttribute(attribute);
    if (value && value.length <= 100) {
      return `${element.tagName.toLowerCase()}[${attribute}="${cssEscape(value)}"]`;
    }
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && parts.length < 6 && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    const className = [...current.classList].find((name) => !name.startsWith("ehinium-"));
    if (className) part += `.${cssEscape(className)}`;

    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === current?.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }

  return parts.join(" > ");
}

function getXPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current) {
    const tagName = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? [...current.parentElement.children].filter((child) => child.tagName === current?.tagName)
      : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : "";
    parts.unshift(`${tagName}${index}`);
    current = current.parentElement;
  }

  return `/${parts.join("/")}`;
}

function getAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const attribute of [...element.attributes].slice(0, 40)) {
    if (attribute.name === "style" || attribute.name === "value") continue;
    attributes[attribute.name] = truncate(attribute.value, 500);
  }

  return attributes;
}

function getDirectTextNodes(element: Element): string[] {
  return [...element.childNodes]
    .filter((node): node is Text => node instanceof Text)
    .map((node) => truncate(node.textContent ?? ""))
    .filter(Boolean);
}

function getChildTextFragments(element: Element): DiagnosticTextFragment[] {
  const fragments: DiagnosticTextFragment[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();

  while (node && fragments.length < 80) {
    if (node instanceof Text) {
      const text = truncate(node.textContent ?? "");
      if (text) fragments.push({ nodeType: "text", text, selector: node.parentElement ? getDiagnosticSelector(node.parentElement) : undefined });
    } else if (node instanceof Element && node !== element) {
      const directText = getDirectTextNodes(node).join(" ");
      if (directText) fragments.push({ nodeType: "element", tagName: node.tagName.toLowerCase(), text: truncate(directText), selector: getDiagnosticSelector(node) });
    }
    node = walker.nextNode();
  }

  return fragments;
}

function getAncestors(element: Element): AncestorDiagnostic[] {
  const ancestors: AncestorDiagnostic[] = [];
  let current = element.parentElement;

  while (current && ancestors.length < MAX_ANCESTORS) {
    const exclusionReason = getContentExclusionReason(current);
    ancestors.push({
      selector: getDiagnosticSelector(current),
      tagName: current.tagName.toLowerCase(),
      textPreview: truncate(current.textContent ?? "", 240),
      excluded: exclusionReason !== null,
      exclusionReason: exclusionReason ?? undefined,
    });
    current = current.parentElement;
  }

  return ancestors;
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
}

function looksPriceLike(text: string): boolean {
  return /[0-9٠-٩۰-۹]/u.test(text) && currencyIdentifierRegex.test(text);
}

function findPriceContextElement(node: Text): HTMLElement | null {
  let current = node.parentElement;
  let depth = 0;

  while (current && depth < 4) {
    const text = truncate(collectSourceTextFragments(current).input, MAX_ELEMENT_TEXT);
    if (looksPriceLike(text)) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }

  return node.parentElement;
}

function collectPriceLikeElements(root: Element): PriceLikeElementDiagnostic[] {
  const candidates: PriceLikeElementDiagnostic[] = [];

  for (const element of [root, ...root.querySelectorAll("*")].slice(
    0,
    MAX_ELEMENTS_INSPECTED
  )) {
    if (candidates.length >= MAX_PRICE_LIKE_ELEMENTS) break;
    const sourceCollection = collectSourceTextFragments(element as HTMLElement);
    const text = truncate(sourceCollection.input, MAX_ELEMENT_TEXT);
    if (!text || text.length > MAX_ELEMENT_TEXT || !looksPriceLike(text) || !isVisibleElement(element)) continue;

    const directTextNodes = getDirectTextNodes(element);
    const parserMatches = parseCurrencies(text);
    const meaningfulChildren = [...element.childNodes].filter((node) => truncate(node.textContent ?? "").length > 0);
    candidates.push({
      selector: getDiagnosticSelector(element),
      tagName: element.tagName.toLowerCase(),
      text,
      directTextNodes,
      splitAcrossNodes: meaningfulChildren.length > 1,
      visible: true,
      parserMatches,
    });
  }

  return candidates.filter((candidate, index, all) =>
    !all.some((other, otherIndex) => otherIndex > index && other.text === candidate.text && other.selector.startsWith(candidate.selector))
  );
}

function createEvent(
  stage: DiagnosticEvent["stage"],
  status: DiagnosticEvent["status"],
  details: Omit<DiagnosticEvent, "timestamp" | "stage" | "status"> = {}
): DiagnosticEvent {
  return { timestamp: new Date().toISOString(), stage, status, ...details };
}

async function collectTextNodeDiagnostics(
  root: Element,
  settings: UserSettings | null
): Promise<{ textNodes: TextNodeDiagnostic[]; events: DiagnosticEvent[] }> {
  const allNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current && allNodes.length < MAX_TEXT_NODES) {
    if (truncate(current.textContent ?? "")) allNodes.push(current as Text);
    current = walker.nextNode();
  }

  const scannedNodes = new Set(await collectTextNodesForScan([root]));
  const domMatches = collectCurrencyDomMatches([...scannedNodes]);
  const allMatches = domMatches.map((candidate) => candidate.match);
  let rates: Record<string, number> | null = null;
  if (settings && settings.converterMode !== "units" && allMatches.some((match) => match.currency !== settings.targetCurrency)) {
    try {
      rates = (await getExchangeRates(settings.targetCurrency)).rates;
    } catch {
      rates = null;
    }
  }

  const events: DiagnosticEvent[] = [];
  const textNodes = allNodes.map((node, index): TextNodeDiagnostic => {
    const id = `text-${index + 1}`;
    const parent = node.parentElement;
    const text = node.textContent ?? "";
    const scanned = scannedNodes.has(node);
    const scanExclusion = scanned ? null : getTextNodeScanExclusion(node);
    const scanSkipReason = scanned ? undefined : scanExclusion?.reason ?? getTextNodeScanExclusionReason(node) ?? "Node was outside the collected scan roots or scan limit";
    events.push(createEvent("scanner", scanned ? "pass" : "skip", { textNodeId: id, selector: parent ? getDiagnosticSelector(parent) : undefined, reason: scanSkipReason }));

    const parserMatches = scanned ? parseCurrencies(text) : [];
    events.push(createEvent("parser", scanned ? (parserMatches.length ? "pass" : "skip") : "skip", { textNodeId: id, selector: parent ? getDiagnosticSelector(parent) : undefined, reason: scanned && parserMatches.length === 0 ? "Production parser produced no matches" : scanSkipReason }));
    const priceContext = findPriceContextElement(node);
    const siblingTextFragments = priceContext
      ? [...priceContext.childNodes]
          .map((child) =>
            child instanceof HTMLElement
              ? truncate(collectSourceTextFragments(child).input)
              : truncate(child.textContent ?? "")
          )
          .filter(Boolean)
      : [];
    const combinedCollection = priceContext
      ? collectSourceTextFragments(priceContext)
      : null;
    const combinedParentText = truncate(combinedCollection?.input ?? "", MAX_ELEMENT_TEXT);
    const combinedParentMatches = combinedParentText ? parseCurrencies(combinedParentText) : [];
    const splitAcrossNodes =
      siblingTextFragments.length > 1 &&
      parserMatches.length === 0 &&
      looksPriceLike(combinedParentText);
    const renderBaseReason = scanned ? getCurrencyTextNodeRenderSkipReason(node) : scanSkipReason;
    let conversionRequested = false;
    let rateAvailable: boolean | undefined;
    let conversionSkipReason: string | undefined;
    let renderingAttempted = false;
    let renderingSkipReason: string | undefined;
    const nodeDomMatches = domMatches.filter(
      (candidate) => candidate.sourceNodes[0] === node
    );
    const productionEvents = getDebugEvents();
    const matchDiagnostics: MatchPipelineDiagnostic[] = nodeDomMatches.map(
      (candidate) => {
        const duplicate = getDuplicateDecision(
          candidate,
          settings?.targetCurrency ?? "target-currency-unavailable"
        );
        const contextReason = getCurrencyTextNodeRenderSkipReason(
          candidate.sourceNodes[0]
        );
        const renderedBadge = [...document.querySelectorAll<HTMLElement>("[data-ehinium-source-match]")]
          .find((badge) => badge.getAttribute("data-ehinium-source-match") === duplicate.processedMatchKey);
        const anchorSelection = selectPriceAnchor(
          candidate.sourceNodes,
          candidate.scanKind === "direct"
            ? candidate.parserInput
            : candidate.sourceNodes.map((sourceNode) => sourceNode.textContent ?? "").join(""),
          candidate.scanKind === "direct" ? candidate.match : undefined
        );

        return {
          parserInput: candidate.parserInput,
          rawMatch: candidate.match.raw,
          start: candidate.match.start,
          end: candidate.match.end,
          sourceTextNode: truncate(candidate.sourceNodes[0]?.textContent ?? "", MAX_FRAGMENT_TEXT),
          sourceElement: getDiagnosticSelector(candidate.sourceElement),
          fragmentMap: candidate.fragmentMap.map((fragment) => ({
            sourceTextNode: truncate(fragment.node.textContent ?? "", MAX_FRAGMENT_TEXT),
            sourceElement: fragment.node.parentElement
              ? getDiagnosticSelector(fragment.node.parentElement)
              : "(no parent)",
            combinedStart: fragment.combinedStart,
            combinedEnd: fragment.combinedEnd,
          })),
          selectedRenderingAnchor: getDiagnosticSelector(candidate.renderingAnchor),
          processedMatchKey: duplicate.processedMatchKey,
          duplicateDecision: duplicate.duplicate ? "skip-duplicate" : "render",
          duplicateReason: duplicate.reason,
          stableSourceFingerprint: duplicate.sourceFingerprint,
          scopeFingerprint: duplicate.scopeFingerprint,
          previousOwner: duplicate.previousOwner,
          currentOwner: `${duplicate.ownerPositionKey}:${duplicate.sourceFingerprint}`,
          reconciliationDecision: duplicate.decision,
          badgeConnectivityState: renderedBadge?.isConnected
            ? "connected"
            : renderedBadge
              ? "disconnected"
              : "not-rendered",
          anchorSafety: anchorSelection.selected ?? anchorSelection.candidates.at(-1)!,
          reconciliation: duplicate.reconciliation,
          translationWrapper: getTranslationWrapperDiagnostic(
            candidate,
            settings?.targetCurrency ?? "target-currency-unavailable",
            duplicate.reason
          ),
          combinedParentSkipReason: candidate.scanKind === "direct"
            ? "Leaf price match takes priority over combined parent match"
            : undefined,
          localCombinedTextScanAttempted: candidate.localCombinedScanAttempted,
          directNodeParserSucceeded: candidate.directNodeParserSucceeded,
          contextRejectionOccurred: contextReason !== null,
          contextRejectionReason: contextReason ?? undefined,
          conversionRequest: {
            sourceCurrency: candidate.match.currency,
            targetCurrency: settings?.targetCurrency,
            amount: candidate.match.amount,
          },
          rateAvailable:
            settings && candidate.match.currency !== settings.targetCurrency
              ? rates?.[candidate.match.currency] !== undefined
              : undefined,
          renderedBadge: renderedBadge ? getBadgeVisibleText(renderedBadge) : undefined,
          mutationEvents: productionEvents.filter((event) => event.type.startsWith("scan:")),
          excludedExtensionFragmentCount:
            candidate.excludedExtensionFragmentCount,
          combinedTextContainsExtensionUi:
            candidate.combinedTextContainsExtensionUi,
        };
      }
    );

    if (parserMatches.length === 0) {
      conversionSkipReason = scanned ? "Parser produced no currency matches" : "Text node was not scanned";
      renderingSkipReason = conversionSkipReason;
    } else if (!settings) {
      conversionSkipReason = "Extension settings were unavailable";
      renderingSkipReason = conversionSkipReason;
    } else if (settings.converterMode === "units") {
      conversionSkipReason = "Currency conversion is disabled by converter mode";
      renderingSkipReason = conversionSkipReason;
    } else if (renderBaseReason) {
      conversionSkipReason = "Conversion not reached because renderer rejected the text context";
      renderingSkipReason = renderBaseReason;
    } else {
      const convertibleMatches = parserMatches.filter((match) => match.currency !== settings.targetCurrency);
      if (convertibleMatches.length === 0) {
        conversionSkipReason = "All matches already use the target currency";
        renderingSkipReason = conversionSkipReason;
      } else {
        conversionRequested = true;
        rateAvailable = rates !== null && convertibleMatches.every((match) => rates?.[match.currency] !== undefined);
        events.push(createEvent("conversion", "attempt", { textNodeId: id, selector: parent ? getDiagnosticSelector(parent) : undefined, match: convertibleMatches[0] }));
        if (!rateAvailable) {
          conversionSkipReason = rates ? "One or more source rates are unavailable" : "Exchange-rate request failed";
          renderingSkipReason = conversionSkipReason;
          events.push(createEvent("conversion", "fail", { textNodeId: id, reason: conversionSkipReason }));
        } else {
          const anchor = findPriceAnchor(node);
          const placementReason = anchor && settings ? getCurrencyPlacementSkipReason(anchor, settings.badgeVisibility) : "No price anchor was found";
          if (placementReason) {
            renderingSkipReason = placementReason;
            events.push(createEvent("renderer", "skip", { textNodeId: id, reason: placementReason }));
          } else {
            renderingAttempted = true;
            events.push(createEvent("renderer", "attempt", { textNodeId: id, selector: anchor ? getDiagnosticSelector(anchor) : undefined }));
          }
        }
      }
    }

    return {
      id,
      parentSelector: parent ? getDiagnosticSelector(parent) : "(no parent)",
      text,
      scanned,
      scanSkipReason,
      splitAcrossNodes,
      siblingTextFragments,
      parserAttempted: scanned,
      parserMatches,
      combinedParentText,
      combinedParentMatches,
      conversionRequested,
      rateAvailable,
      conversionSkipReason,
      renderingAttempted,
      renderingSkipReason,
      exclusionRule: scanExclusion?.rule,
      exclusionCausingAncestor: scanExclusion?.element
        ? getDiagnosticSelector(scanExclusion.element)
        : undefined,
      exclusionCategory: scanExclusion?.category,
      matchDiagnostics,
    };
  });

  return { textNodes, events };
}

function buildSelectedElementDiagnostic(element: HTMLElement, events: DiagnosticEvent[]): SelectedElementDiagnostic {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const innerText = element.innerText ?? "";
  return {
    pageUrl: location.href,
    pageTitle: document.title,
    timestamp: new Date().toISOString(),
    selector: getDiagnosticSelector(element),
    xpath: getXPath(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? undefined,
    classNames: [...element.classList],
    attributes: getAttributes(element),
    textContent: element.textContent ?? "",
    innerText,
    directTextNodes: getDirectTextNodes(element),
    childTextFragments: getChildTextFragments(element),
    computed: {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      direction: style.direction,
      whiteSpace: style.whiteSpace,
    },
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    ancestors: getAncestors(element),
    parserResults: parseCurrencies(collectSourceTextFragments(element).input),
    diagnosticEvents: events,
  };
}

async function captureReport(
  settings: UserSettings | null,
  scope: PageDiagnosticReport["scope"],
  selectedElement?: HTMLElement
): Promise<PageDiagnosticReport> {
  const root = selectedElement ?? document.body;
  const priceLikeElements = collectPriceLikeElements(root);
  const { textNodes, events } = await collectTextNodeDiagnostics(root, settings);
  const report: PageDiagnosticReport = {
    schema: "ehinium-page-diagnostics/v2",
    scope,
    pageUrl: location.href,
    pageTitle: document.title,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    settings,
    summary: {
      priceLikeElementCount: priceLikeElements.length,
      nonEmptyTextNodeCount: textNodes.length,
      scannedTextNodeCount: textNodes.filter((item) => item.scanned).length,
      skippedTextNodeCount: textNodes.filter((item) => !item.scanned).length,
      parserMatchCount: textNodes.reduce((total, item) => total + item.matchDiagnostics.length, 0),
      splitPriceCandidateCount: textNodes.filter((item) => item.splitAcrossNodes).length,
      diagnosticEventCount: events.length,
    },
    priceLikeElements,
    textNodes,
    selectedElement: selectedElement ? buildSelectedElementDiagnostic(selectedElement, events) : undefined,
    diagnosticEvents: events,
    productionDebugEvents: getDebugEvents(),
    mutationBatches: getMutationBatchDiagnostics(),
    badgeVisibility: getBadgeVisibilityDiagnostics(),
    renderLifecycles: getRenderLifecycleDiagnostics(),
    overlayPlacements: getOverlayPlacementDiagnostics(),
    overlayPlacementGroups: getOverlayPlacementGroupDiagnostics(),
    candidateDiscovery: getCandidateDiscoveryDiagnostics(),
    canonicalization: getCanonicalizationDiagnostics(),
    visualSourceReconciliation: getVisualSourceReconciliationDiagnostics(),
    badgeEncapsulation: getBadgeEncapsulationDiagnostics(),
    translationProtection: getTranslationProtectionDiagnostics(),
    badgeHostCensus: getBadgeHostCensusDiagnostic(),
    badgeHostReconciliation: getBadgeHostReconciliationDiagnostics(),
    limits: {
      maxTextNodes: MAX_TEXT_NODES,
      maxPriceLikeElements: MAX_PRICE_LIKE_ELEMENTS,
      maxElementsInspected: MAX_ELEMENTS_INSPECTED,
      maxAncestors: MAX_ANCESTORS,
    },
  };
  latestReport = report;
  return report;
}

export function capturePageDiagnostics(settings: UserSettings | null): Promise<PageDiagnosticReport> {
  return captureReport(settings, "page");
}

export function startElementDiagnosticPicker(settings: UserSettings | null): void {
  stopActivePicker?.();
  const overlay = document.createElement("div");
  overlay.setAttribute(PICKER_ATTRIBUTE, "true");
  overlay.setAttribute("data-ehinium-ignore", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    border: "2px solid #6d5dfc",
    background: "rgba(109, 93, 252, 0.12)",
    boxSizing: "border-box",
    display: "none",
  });
  document.documentElement.append(overlay);
  let hovered: HTMLElement | null = null;

  const updateOverlay = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };
  const onPointerMove = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === overlay || target.closest(`[${PICKER_ATTRIBUTE}]`)) return;
    hovered = target;
    updateOverlay(target);
  };
  const cleanup = (): void => {
    document.removeEventListener("mousemove", onPointerMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
    overlay.remove();
    if (stopActivePicker === cleanup) stopActivePicker = null;
  };
  const onClick = (event: MouseEvent): void => {
    if (!hovered) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const selected = hovered;
    cleanup();
    void captureReport(settings, "selected-element", selected);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") cleanup();
  };
  const onScroll = (): void => {
    if (hovered) updateOverlay(hovered);
  };

  document.addEventListener("mousemove", onPointerMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  stopActivePicker = cleanup;
}

export function getLatestPageDiagnosticReport(): PageDiagnosticReport | null {
  return latestReport;
}

export function clearPageDiagnosticSession(): void {
  stopActivePicker?.();
  latestReport = null;
  clearMutationBatchDiagnostics();
}
