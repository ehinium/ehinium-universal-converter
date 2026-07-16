import type { CurrencyMatch } from "../utils/currencyParser";
import type { DebugEvent } from "../content/debug";
import type { UserSettings } from "./settings";
import type {
  BadgeHostCensusDiagnostic,
  BadgeHostReconciliationDiagnostic,
} from "../content/badgeHostRegistry";
import type { BadgeVisibilityDiagnostic } from "../content/badgeVisibility";
import type { AnchorSafetyDiagnostic } from "../content/priceAnchor";
import type { ReconciliationDiagnostic } from "../content/currencyMatchState";
import type { TranslationWrapperDiagnostic } from "../content/translationLineage";
import type {
  OverlayPlacementDiagnostic,
  OverlayPlacementGroupDiagnostic,
  RenderLifecycleDiagnostic,
} from "../content/badgeLifecycle";
import type {
  CandidateDiscoveryDiagnostic,
  CanonicalizationDiagnostic,
  VisualSourceReconciliationDiagnostic,
} from "../content/priceCandidatePipeline";
import type {
  BadgeEncapsulationDiagnostic,
  TranslationProtectionDiagnostic,
} from "../content/badgeHost";

export type DiagnosticStage =
  | "visibility"
  | "scanner"
  | "parser"
  | "conversion"
  | "renderer";

export type DiagnosticEvent = {
  timestamp: string;
  stage: DiagnosticStage;
  status: "attempt" | "pass" | "skip" | "fail";
  reason?: string;
  textNodeId?: string;
  selector?: string;
  match?: CurrencyMatch;
};

export type DiagnosticTextFragment = {
  nodeType: string;
  tagName?: string;
  text: string;
  selector?: string;
};

export type AncestorDiagnostic = {
  selector: string;
  tagName: string;
  textPreview: string;
  excluded: boolean;
  exclusionReason?: string;
};

export type SelectedElementDiagnostic = {
  pageUrl: string;
  pageTitle: string;
  timestamp: string;
  selector: string;
  xpath?: string;
  tagName: string;
  role?: string;
  classNames: string[];
  attributes: Record<string, string>;
  textContent: string;
  innerText: string;
  directTextNodes: string[];
  childTextFragments: DiagnosticTextFragment[];
  computed: {
    display: string;
    visibility: string;
    opacity: string;
    direction: string;
    whiteSpace: string;
  };
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  ancestors: AncestorDiagnostic[];
  parserResults: CurrencyMatch[];
  diagnosticEvents: DiagnosticEvent[];
};

export type TextNodeDiagnostic = {
  id: string;
  parentSelector: string;
  text: string;
  scanned: boolean;
  scanSkipReason?: string;
  splitAcrossNodes: boolean;
  siblingTextFragments: string[];
  parserAttempted: boolean;
  parserMatches: CurrencyMatch[];
  combinedParentText: string;
  combinedParentMatches: CurrencyMatch[];
  conversionRequested: boolean;
  rateAvailable?: boolean;
  conversionSkipReason?: string;
  renderingAttempted: boolean;
  renderingSkipReason?: string;
  exclusionRule?: string;
  exclusionCausingAncestor?: string;
  exclusionCategory?: "extension-ui" | "source-content";
  matchDiagnostics: MatchPipelineDiagnostic[];
};

export type MatchPipelineDiagnostic = {
  parserInput: string;
  rawMatch: string;
  start: number;
  end: number;
  sourceTextNode: string;
  sourceElement: string;
  fragmentMap: Array<{
    sourceTextNode: string;
    sourceElement: string;
    combinedStart: number;
    combinedEnd: number;
  }>;
  selectedRenderingAnchor: string;
  processedMatchKey: string;
  duplicateDecision: "render" | "skip-duplicate";
  duplicateReason?: string;
  stableSourceFingerprint: string;
  scopeFingerprint: string;
  previousOwner?: string;
  currentOwner: string;
  reconciliationDecision: string;
  badgeConnectivityState: "connected" | "disconnected" | "not-rendered";
  anchorSafety: AnchorSafetyDiagnostic;
  reconciliation: ReconciliationDiagnostic;
  translationWrapper: TranslationWrapperDiagnostic;
  combinedParentSkipReason?: string;
  exclusionRule?: string;
  exclusionCausingAncestor?: string;
  exclusionCategory?: "extension-ui" | "source-content";
  localCombinedTextScanAttempted: boolean;
  directNodeParserSucceeded: boolean;
  contextRejectionOccurred: boolean;
  contextRejectionReason?: string;
  conversionRequest: {
    sourceCurrency: string;
    targetCurrency?: string;
    amount: number;
  };
  rateAvailable?: boolean;
  renderedBadge?: string;
  mutationEvents: DebugEvent[];
  excludedExtensionFragmentCount: number;
  combinedTextContainsExtensionUi: boolean;
};

export type PriceLikeElementDiagnostic = {
  selector: string;
  tagName: string;
  text: string;
  directTextNodes: string[];
  splitAcrossNodes: boolean;
  visible: boolean;
  parserMatches: CurrencyMatch[];
};

export type PageDiagnosticReport = {
  schema: "ehinium-page-diagnostics/v2";
  scope: "page" | "selected-element";
  pageUrl: string;
  pageTitle: string;
  timestamp: string;
  userAgent: string;
  settings: UserSettings | null;
  summary: {
    priceLikeElementCount: number;
    nonEmptyTextNodeCount: number;
    scannedTextNodeCount: number;
    skippedTextNodeCount: number;
    parserMatchCount: number;
    splitPriceCandidateCount: number;
    diagnosticEventCount: number;
  };
  priceLikeElements: PriceLikeElementDiagnostic[];
  textNodes: TextNodeDiagnostic[];
  selectedElement?: SelectedElementDiagnostic;
  diagnosticEvents: DiagnosticEvent[];
  productionDebugEvents: DebugEvent[];
  mutationBatches: MutationBatchDiagnostic[];
  badgeVisibility: BadgeVisibilityDiagnostic[];
  renderLifecycles: RenderLifecycleDiagnostic[];
  overlayPlacements: OverlayPlacementDiagnostic[];
  overlayPlacementGroups: OverlayPlacementGroupDiagnostic[];
  candidateDiscovery: CandidateDiscoveryDiagnostic[];
  canonicalization: CanonicalizationDiagnostic[];
  visualSourceReconciliation: VisualSourceReconciliationDiagnostic[];
  badgeEncapsulation: BadgeEncapsulationDiagnostic[];
  translationProtection: TranslationProtectionDiagnostic[];
  badgeHostCensus: BadgeHostCensusDiagnostic;
  badgeHostReconciliation: BadgeHostReconciliationDiagnostic[];
  limits: {
    maxTextNodes: number;
    maxPriceLikeElements: number;
    maxElementsInspected: number;
    maxAncestors: number;
  };
};

export type MutationBatchDiagnostic = {
  batchId: string;
  timestamp: string;
  mutationCategory: "site-content" | "extension-ui" | "mixed";
  mutationCount: number;
  addedSourceNodeCount: number;
  removedSourceNodeCount: number;
  extensionOwnedMutationCount: number;
  affectedSourceScopes: string[];
  preReconciliationSourceMatches: string[];
  existingOwnedBadgeCount: number;
  adoptedBadgeCount: number;
  updatedBadgeCount: number;
  removedStaleBadgeCount: number;
  newlyRenderedBadgeCount: number;
  finalActiveBadgeCount?: number;
  warnings: string[];
};
