import { parseCurrencies } from "../utils/currencyParser";
import { isInsideExcludedContent } from "./domExclusions";

export type RectSnapshot = { x: number; y: number; width: number; height: number };
export type OverlayPlacementId =
  | "inline-end"
  | "inline-start"
  | "above-end"
  | "above-start"
  | "below-end"
  | "below-start";

export type OverlayPlacementCandidateDiagnostic = {
  id: OverlayPlacementId;
  valid: boolean;
  score: number;
  rejectionReasons: string[];
  rect: RectSnapshot;
};

export type OverlayPlacementDiagnostic = {
  logicalSourceKey: string;
  rootConnected: boolean;
  sourceConnected: boolean;
  rangeValid: boolean;
  rectCount: number;
  sourceRect: RectSnapshot;
  badgeRect: RectSnapshot;
  hiddenBySuppression: boolean;
  lastPositionReason: string;
  sourceRangeValid: boolean;
  exactSourceRect: RectSnapshot;
  semanticSourceRect: RectSnapshot;
  placementScopeSelector: string;
  direction: "ltr" | "rtl";
  candidateCount: number;
  candidates: OverlayPlacementCandidateDiagnostic[];
  selectedPlacement: OverlayPlacementId | null;
  previousPlacement: OverlayPlacementId | null;
  retainedByHysteresis: boolean;
  sourceOverlapPx: number;
  nearbyTextOverlapPx: number;
  badgeOverlapPx: number;
  clippingDetected: boolean;
  rangeFallbackReason?: string;
};

export type OverlayPlacementGroupDiagnostic = {
  groupId: string;
  badgeCount: number;
  sourceSelectors: string[];
  placementOrder: string[];
  collisionResolutionUsed: boolean;
  backtrackingSteps: number;
  unresolvedCollisionCount: number;
};

export type OverlaySourceInput = {
  logicalKey: string;
  badge: HTMLElement;
  sourceElement: HTMLElement;
  anchor: HTMLElement;
  sourceNodes: Text[];
  fragmentMap: Array<{ node: Text; combinedStart: number; combinedEnd: number }>;
  parserInput: string;
  raw: string;
  start: number;
  end: number;
  previousPlacement: OverlayPlacementId | null;
};

export type OverlayPlacementResult = {
  logicalKey: string;
  placement: OverlayPlacementId | null;
  rect: RectSnapshot;
  exactRect: RectSnapshot;
  semanticRect: RectSnapshot;
  diagnostic: OverlayPlacementDiagnostic;
  scope: HTMLElement;
};

type Boundary = { node: Text; offset: number };
type RangeGeometry = { rect: RectSnapshot; rectCount: number; valid: boolean; fallbackReason?: string };
type Prepared = {
  input: OverlaySourceInput;
  scope: HTMLElement;
  exact: RangeGeometry;
  semantic: RangeGeometry;
  badgeSize: { width: number; height: number };
  direction: "ltr" | "rtl";
  bounds: RectSnapshot;
  clippingDetected: boolean;
  nearbyText: RectSnapshot[];
  interactive: RectSnapshot[];
  candidates: OverlayPlacementCandidateDiagnostic[];
};

const GAP = 6;
const HYSTERESIS_SCORE = 10;
const MAX_BACKTRACKING_STEPS = 256;
let nextGroupId = 1;

function rect(x: number, y: number, width: number, height: number): RectSnapshot {
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function right(value: RectSnapshot): number { return value.x + value.width; }
function bottom(value: RectSnapshot): number { return value.y + value.height; }
function area(value: RectSnapshot): number { return value.width * value.height; }

function intersectionArea(first: RectSnapshot, second: RectSnapshot): number {
  return Math.max(0, Math.min(right(first), right(second)) - Math.max(first.x, second.x)) *
    Math.max(0, Math.min(bottom(first), bottom(second)) - Math.max(first.y, second.y));
}

function intersects(first: RectSnapshot, second: RectSnapshot): boolean {
  return intersectionArea(first, second) > 0;
}

function contains(bounds: RectSnapshot, value: RectSnapshot): boolean {
  return value.x >= bounds.x && value.y >= bounds.y && right(value) <= right(bounds) && bottom(value) <= bottom(bounds);
}

function fromDomRect(value: DOMRect | DOMRectReadOnly): RectSnapshot {
  return rect(value.left, value.top, value.width, value.height);
}

function union(values: readonly RectSnapshot[]): RectSnapshot {
  const nonEmpty = values.filter((value) => value.width > 0 && value.height > 0);
  if (nonEmpty.length === 0) return rect(0, 0, 0, 0);
  const x = Math.min(...nonEmpty.map((value) => value.x));
  const y = Math.min(...nonEmpty.map((value) => value.y));
  return rect(x, y, Math.max(...nonEmpty.map(right)) - x, Math.max(...nonEmpty.map(bottom)) - y);
}

function intersectBounds(first: RectSnapshot, second: RectSnapshot): RectSnapshot {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  return rect(x, y, Math.max(0, Math.min(right(first), right(second)) - x), Math.max(0, Math.min(bottom(first), bottom(second)) - y));
}

function boundaryAt(input: OverlaySourceInput, offset: number, endBoundary: boolean): Boundary | null {
  const fragment = input.fragmentMap.find((item) => endBoundary
    ? offset > item.combinedStart && offset <= item.combinedEnd
    : offset >= item.combinedStart && offset < item.combinedEnd);
  if (!fragment) return null;
  return { node: fragment.node, offset: Math.max(0, Math.min(fragment.node.length, offset - fragment.combinedStart)) };
}

function geometryForOffsets(input: OverlaySourceInput, start: number, end: number): RangeGeometry {
  const startBoundary = boundaryAt(input, start, false);
  const endBoundary = boundaryAt(input, end, true);
  if (!startBoundary || !endBoundary || !startBoundary.node.isConnected || !endBoundary.node.isConnected) {
    return { rect: fromDomRect(input.sourceElement.getBoundingClientRect()), rectCount: 0, valid: false, fallbackReason: "Exact source range unavailable" };
  }
  try {
    const range = input.sourceElement.ownerDocument.createRange();
    range.setStart(startBoundary.node, startBoundary.offset);
    range.setEnd(endBoundary.node, endBoundary.offset);
    const rects = typeof range.getClientRects === "function"
      ? [...range.getClientRects()].map(fromDomRect).filter((item) => area(item) > 0)
      : [];
    const bounding = typeof range.getBoundingClientRect === "function" ? fromDomRect(range.getBoundingClientRect()) : union(rects);
    if (area(bounding) > 0) return { rect: bounding, rectCount: Math.max(1, rects.length), valid: true };
    return {
      rect: fromDomRect(input.sourceElement.getBoundingClientRect()), rectCount: rects.length,
      valid: true, fallbackReason: "Exact range had no measurable rectangle; smallest source element used",
    };
  } catch {
    return { rect: fromDomRect(input.sourceElement.getBoundingClientRect()), rectCount: 0, valid: false, fallbackReason: "Exact source range rebuild failed" };
  }
}

function semanticEnd(input: OverlaySourceInput): number {
  const suffix = input.parserInput.slice(input.end).match(
    /^\s*(?:(?:\/\s*(?:months?|mos?|years?|yrs?|pieces?|units?))|(?:per\s+(?:month|year|piece|unit))|(?:tax\s+included)|(?:incl\.?\s+tax)|(?:excl\.?\s+tax))/iu
  );
  return suffix ? input.end + suffix[0].length : input.end;
}

function selector(element: HTMLElement): string {
  if (element.id) return `#${element.id}`;
  const className = [...element.classList].find((item) => !item.startsWith("ehinium-"));
  return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
}

function placementScope(input: OverlaySourceInput): HTMLElement {
  let current = input.anchor;
  for (let depth = 0; depth < 3; depth++) {
    const text = current.textContent ?? "";
    if (parseCurrencies(text).length > 1 || text.trim().length > input.raw.trim().length + 4) return current;
    const parent = current.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    current = parent;
  }
  return input.anchor;
}

function viewportBounds(): RectSnapshot {
  const visual = window.visualViewport;
  if (visual) return rect(visual.offsetLeft, visual.offsetTop, visual.width, visual.height);
  return rect(0, 0, document.documentElement.clientWidth || window.innerWidth, document.documentElement.clientHeight || window.innerHeight);
}

function clippingBounds(source: HTMLElement): { bounds: RectSnapshot; clippingDetected: boolean } {
  let bounds = viewportBounds();
  let clippingDetected = false;
  let current = source.parentElement;
  while (current && current !== document.documentElement) {
    const style = getComputedStyle(current);
    const clipsX = /(?:hidden|clip|auto|scroll)/u.test(style.overflowX || style.overflow);
    const clipsY = /(?:hidden|clip|auto|scroll)/u.test(style.overflowY || style.overflow);
    const establishesVisualBoundary = (!!style.transform && style.transform !== "none") ||
      (!!style.perspective && style.perspective !== "none") ||
      (!!style.filter && style.filter !== "none") || /(?:paint|layout|strict|content)/u.test(style.contain);
    if (clipsX || clipsY || establishesVisualBoundary) {
      const elementRect = fromDomRect(current.getBoundingClientRect());
      if (area(elementRect) > 0) {
        bounds = intersectBounds(bounds, elementRect);
        clippingDetected = true;
      }
    }
    current = current.parentElement;
  }
  return { bounds, clippingDetected };
}

function rangeSegmentRect(node: Text, start: number, end: number): RectSnapshot[] {
  if (end <= start || !node.isConnected) return [];
  try {
    const range = node.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return [...range.getClientRects()].map(fromDomRect).filter((item) => area(item) > 0);
  } catch {
    return [];
  }
}

function nearbyTextRects(input: OverlaySourceInput, scope: HTMLElement, semanticFinish: number): RectSnapshot[] {
  const values: RectSnapshot[] = [];
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (!isInsideExcludedContent(node) && node.textContent?.trim()) {
      const fragment = input.fragmentMap.find((item) => item.node === node);
      if (!fragment) values.push(...rangeSegmentRect(node, 0, node.length));
      else {
        const localStart = Math.max(0, input.start - fragment.combinedStart);
        const localEnd = Math.min(node.length, semanticFinish - fragment.combinedStart);
        values.push(...rangeSegmentRect(node, 0, localStart));
        values.push(...rangeSegmentRect(node, Math.max(0, localEnd), node.length));
      }
    }
    current = walker.nextNode();
  }
  return values;
}

function interactiveRects(scope: HTMLElement, source: HTMLElement): RectSnapshot[] {
  const interactive = [...scope.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[role="button"],[tabindex]')];
  if (scope.matches('a[href],button,input,select,textarea,[role="button"],[tabindex]')) interactive.unshift(scope);
  return interactive.filter((element) => element !== source && !element.contains(source) && !isInsideExcludedContent(element))
    .map((element) => fromDomRect(element.getBoundingClientRect())).filter((item) => area(item) > 0);
}

function badgeSize(badge: HTMLElement): { width: number; height: number } {
  const measured = badge.getBoundingClientRect();
  return { width: measured.width || badge.offsetWidth || 1, height: measured.height || badge.offsetHeight || 1 };
}

function candidateRects(source: RectSnapshot, size: { width: number; height: number }, direction: "ltr" | "rtl"): Array<{ id: OverlayPlacementId; rect: RectSnapshot; base: number }> {
  const endX = direction === "ltr" ? right(source) + GAP : source.x - GAP - size.width;
  const startX = direction === "ltr" ? source.x - GAP - size.width : right(source) + GAP;
  const endAlignedX = direction === "ltr" ? right(source) - size.width : source.x;
  const startAlignedX = direction === "ltr" ? source.x : right(source) - size.width;
  const inlineY = source.y + (source.height - size.height) / 2;
  return [
    { id: "inline-end", rect: rect(endX, inlineY, size.width, size.height), base: 110 },
    { id: "inline-start", rect: rect(startX, inlineY, size.width, size.height), base: 96 },
    { id: "above-end", rect: rect(endAlignedX, source.y - GAP - size.height, size.width, size.height), base: 82 },
    { id: "above-start", rect: rect(startAlignedX, source.y - GAP - size.height, size.width, size.height), base: 78 },
    { id: "below-end", rect: rect(endAlignedX, bottom(source) + GAP, size.width, size.height), base: 80 },
    { id: "below-start", rect: rect(startAlignedX, bottom(source) + GAP, size.width, size.height), base: 76 },
  ];
}

function evaluateCandidates(prepared: Prepared, sourceRects: readonly RectSnapshot[], occupiedBadges: readonly RectSnapshot[]): OverlayPlacementCandidateDiagnostic[] {
  return candidateRects(prepared.semantic.rect, prepared.badgeSize, prepared.direction).map((candidate) => {
    const reasons: string[] = [];
    const ownSourceOverlap = intersectionArea(candidate.rect, prepared.semantic.rect);
    const otherSourceOverlap = sourceRects.reduce((sum, item) => sum + (item === prepared.semantic.rect ? 0 : intersectionArea(candidate.rect, item)), 0);
    const nearbyOverlap = prepared.nearbyText.reduce((sum, item) => sum + intersectionArea(candidate.rect, item), 0);
    const badgeOverlap = occupiedBadges.reduce((sum, item) => sum + intersectionArea(candidate.rect, item), 0);
    const interactiveOverlap = prepared.interactive.reduce((sum, item) => sum + intersectionArea(candidate.rect, item), 0);
    if (ownSourceOverlap > 0) {
      reasons.push(intersectionArea(candidate.rect, prepared.exact.rect) > 0
        ? "Overlaps source text"
        : "Overlaps semantic suffix");
    }
    if (otherSourceOverlap > 0) reasons.push("Overlaps adjacent old price");
    if (nearbyOverlap > 0) reasons.push("Overlaps nearby text");
    if (badgeOverlap > 0) reasons.push("Overlaps another badge");
    if (interactiveOverlap > 0) reasons.push("Overlaps interactive content");
    if (!contains(viewportBounds(), candidate.rect)) reasons.push("Outside viewport");
    if (!contains(prepared.bounds, candidate.rect)) reasons.push("Clipped by overflow ancestor");
    if (candidate.id === "inline-end" && (reasons.includes("Overlaps nearby text") || reasons.includes("Overlaps adjacent old price"))) {
      reasons.push("Inline end lacks available width");
    }
    const distance = Math.hypot(candidate.rect.x - prepared.semantic.rect.x, candidate.rect.y - prepared.semantic.rect.y);
    const score = candidate.base - distance * 0.08 - interactiveOverlap * 0.25 - (prepared.clippingDetected ? 2 : 0);
    return { id: candidate.id, valid: reasons.length === 0, score: Math.round(score * 100) / 100, rejectionReasons: reasons, rect: candidate.rect };
  });
}

function prepare(input: OverlaySourceInput): Prepared {
  const exact = geometryForOffsets(input, input.start, input.end);
  const finish = semanticEnd(input);
  const semantic = finish > input.end ? geometryForOffsets(input, input.start, finish) : exact;
  const scope = placementScope(input);
  const clipping = clippingBounds(input.sourceElement);
  return {
    input, scope, exact, semantic, badgeSize: badgeSize(input.badge),
    direction: getComputedStyle(input.sourceElement).direction === "rtl" ? "rtl" : "ltr",
    bounds: clipping.bounds, clippingDetected: clipping.clippingDetected,
    nearbyText: nearbyTextRects(input, scope, finish),
    interactive: interactiveRects(scope, input.sourceElement), candidates: [],
  };
}

function groupPrepared(items: Prepared[]): Prepared[][] {
  const groups = new Map<HTMLElement, Prepared[]>();
  for (const item of items) groups.set(item.scope, [...(groups.get(item.scope) ?? []), item]);
  return [...groups.values()];
}

function placementOrder(group: Prepared[]): Prepared[] {
  return [...group].sort((left, rightItem) =>
    left.semantic.rect.y - rightItem.semantic.rect.y || left.semantic.rect.x - rightItem.semantic.rect.x ||
    left.input.logicalKey.localeCompare(rightItem.input.logicalKey)
  );
}

function solveGroup(group: Prepared[], externalBadges: RectSnapshot[]): { selected: Map<Prepared, OverlayPlacementCandidateDiagnostic>; steps: number; unresolved: number } {
  const ordered = placementOrder(group);
  const sources = group.map((item) => item.semantic.rect);
  const selected = new Map<Prepared, OverlayPlacementCandidateDiagnostic>();
  let best = new Map<Prepared, OverlayPlacementCandidateDiagnostic>();
  let bestScore = Number.NEGATIVE_INFINITY;
  let steps = 0;
  const visit = (index: number, score: number): void => {
    if (steps++ >= MAX_BACKTRACKING_STEPS) return;
    if (index === ordered.length) {
      if (score > bestScore) { bestScore = score; best = new Map(selected); }
      return;
    }
    const item = ordered[index];
    item.candidates = evaluateCandidates(item, sources, [...externalBadges, ...[...selected.values()].map((value) => value.rect)]);
    let valid = item.candidates.filter((candidate) => candidate.valid).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const highestScore = valid[0]?.score ?? 0;
    const previous = valid.find((candidate) => candidate.id === item.input.previousPlacement);
    if (previous && valid[0] && valid[0].score - previous.score <= HYSTERESIS_SCORE) {
      valid = [previous, ...valid.filter((candidate) => candidate !== previous)];
    }
    for (const candidate of valid) {
      selected.set(item, candidate);
      const hysteresisBonus = candidate.id === item.input.previousPlacement && highestScore - candidate.score <= HYSTERESIS_SCORE
        ? highestScore - candidate.score + 0.01
        : 0;
      visit(index + 1, score + candidate.score + hysteresisBonus);
      selected.delete(item);
    }
  };
  visit(0, 0);
  if (best.size === ordered.length) return { selected: best, steps, unresolved: 0 };

  const fallback = new Map<Prepared, OverlayPlacementCandidateDiagnostic>();
  const occupied = [...externalBadges];
  let unresolved = 0;
  for (const item of ordered) {
    item.candidates = evaluateCandidates(item, sources, occupied);
    const sourceSafe = item.candidates.filter((candidate) =>
      !candidate.rejectionReasons.includes("Overlaps source text") &&
      !candidate.rejectionReasons.includes("Overlaps semantic suffix") &&
      !candidate.rejectionReasons.includes("Overlaps adjacent old price") &&
      !candidate.rejectionReasons.includes("Overlaps nearby text") &&
      !candidate.rejectionReasons.includes("Outside viewport") &&
      !candidate.rejectionReasons.includes("Clipped by overflow ancestor")
    ).sort((a, b) => {
      const leftOverlap = occupied.reduce((sum, value) => sum + intersectionArea(a.rect, value), 0);
      const rightOverlap = occupied.reduce((sum, value) => sum + intersectionArea(b.rect, value), 0);
      return leftOverlap - rightOverlap || b.score - a.score || a.id.localeCompare(b.id);
    });
    const chosen = sourceSafe[0];
    if (!chosen) { unresolved++; continue; }
    fallback.set(item, chosen);
    occupied.push(chosen.rect);
    if (!chosen.valid) unresolved++;
  }
  return { selected: fallback, steps, unresolved };
}

export function placeOverlayBatch(inputs: readonly OverlaySourceInput[], reason: string): {
  results: OverlayPlacementResult[];
  groups: OverlayPlacementGroupDiagnostic[];
} {
  const prepared = inputs.filter((input) => input.badge.isConnected && input.sourceElement.isConnected).map(prepare);
  const inputBadges = new Set(inputs.map((input) => input.badge));
  const externalBadges = [...document.querySelectorAll<HTMLElement>('[data-euc-badge="true"]')]
    .filter((badge) => badge.isConnected && !inputBadges.has(badge))
    .map((badge) => fromDomRect(badge.getBoundingClientRect())).filter((item) => area(item) > 0);
  const results: OverlayPlacementResult[] = [];
  const groupDiagnostics: OverlayPlacementGroupDiagnostic[] = [];
  const occupiedAcrossGroups = [...externalBadges];
  for (const group of groupPrepared(prepared)) {
    const ordered = placementOrder(group);
    const solved = solveGroup(ordered, occupiedAcrossGroups);
    const groupId = `overlay-group-${nextGroupId++}`;
    for (const item of ordered) {
      const selected = solved.selected.get(item) ?? null;
      const previous = item.input.previousPlacement;
      const retained = !!selected && selected.id === previous;
      const selectedRect = selected?.rect ?? rect(0, 0, 0, 0);
      const sourceOverlap = intersectionArea(selectedRect, item.semantic.rect);
      const nearbyOverlap = item.nearbyText.reduce((sum, value) => sum + intersectionArea(selectedRect, value), 0);
      const otherRects = [...solved.selected.entries()].filter(([other]) => other !== item).map(([, value]) => value.rect);
      const badgeOverlap = otherRects.reduce((sum, value) => sum + intersectionArea(selectedRect, value), 0);
      results.push({
        logicalKey: item.input.logicalKey, placement: selected?.id ?? null, rect: selectedRect,
        exactRect: item.exact.rect, semanticRect: item.semantic.rect, scope: item.scope,
        diagnostic: {
          logicalSourceKey: item.input.logicalKey, rootConnected: item.input.badge.isConnected,
          sourceConnected: item.input.sourceNodes.every((node) => node.isConnected),
          rangeValid: item.exact.valid, rectCount: item.exact.rectCount, sourceRect: item.exact.rect,
          badgeRect: selectedRect, hiddenBySuppression: item.input.badge.style.visibility === "hidden",
          lastPositionReason: selected
            ? retained
              ? "Previous placement retained"
              : selected.id.startsWith("above")
                ? "Above placement selected"
                : selected.id.startsWith("below")
                  ? "Below placement selected"
                  : reason
            : "No collision-free overlay placement",
          sourceRangeValid: item.exact.valid, exactSourceRect: item.exact.rect,
          semanticSourceRect: item.semantic.rect, placementScopeSelector: selector(item.scope),
          direction: item.direction, candidateCount: item.candidates.length,
          candidates: item.candidates.map((candidate) => ({ ...candidate, rejectionReasons: [...candidate.rejectionReasons], rect: { ...candidate.rect } })),
          selectedPlacement: selected?.id ?? null, previousPlacement: previous,
          retainedByHysteresis: retained, sourceOverlapPx: sourceOverlap,
          nearbyTextOverlapPx: nearbyOverlap, badgeOverlapPx: badgeOverlap,
          clippingDetected: item.clippingDetected,
          rangeFallbackReason: item.semantic.fallbackReason ?? item.exact.fallbackReason,
        },
      });
    }
    groupDiagnostics.push({
      groupId, badgeCount: group.length, sourceSelectors: ordered.map((item) => selector(item.input.sourceElement)),
      placementOrder: ordered.map((item) => item.input.logicalKey),
      collisionResolutionUsed: group.length > 1, backtrackingSteps: solved.steps,
      unresolvedCollisionCount: solved.unresolved,
    });
    occupiedAcrossGroups.push(...[...solved.selected.values()].map((value) => value.rect));
  }
  return { results, groups: groupDiagnostics };
}

export function rectsOverlap(first: RectSnapshot, second: RectSnapshot): boolean {
  return intersects(first, second);
}
