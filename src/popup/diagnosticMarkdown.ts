import type { PageDiagnosticReport } from "../types/diagnostics";

function escapeMarkdown(value: string): string {
  return value.replace(/([|`])/gu, "\\$1").replace(/\s+/gu, " ").trim();
}

export function formatPageDiagnosticMarkdown(report: PageDiagnosticReport): string {
  const lines = [
    "# Ehinium page diagnostics",
    "",
    `- Scope: ${report.scope}`,
    `- URL: ${report.pageUrl}`,
    `- Title: ${report.pageTitle}`,
    `- Captured: ${report.timestamp}`,
    `- Target currency: ${report.settings?.targetCurrency ?? "unavailable"}`,
    `- Text nodes: ${report.summary.scannedTextNodeCount} scanned, ${report.summary.skippedTextNodeCount} skipped`,
    `- Price-like elements: ${report.summary.priceLikeElementCount}`,
    `- Parser matches: ${report.summary.parserMatchCount}`,
    `- Split candidates: ${report.summary.splitPriceCandidateCount}`,
    `- Direct text parser matches: ${report.summary.directTextParserMatches}`,
    `- Split text parser matches: ${report.summary.splitTextParserMatches}`,
    `- Cluster explicit matches: ${report.summary.clusterExplicitMatches}`,
    `- Cluster inferred matches: ${report.summary.clusterInferredMatches}`,
    `- Rejected parser matches: ${report.summary.rejectedParserMatches}`,
    `- Candidate construction failures: ${report.summary.candidateConstructionFailures}`,
    `- Canonical candidates: ${report.summary.canonicalCandidates}`,
    `- Rendered badges: ${report.summary.renderedBadges}`,
    "",
  ];

  if (report.selectedElement) {
    lines.push(
      "## Selected element",
      "",
      `- Selector: \`${report.selectedElement.selector}\``,
      `- XPath: \`${report.selectedElement.xpath ?? "unavailable"}\``,
      `- Element: \`${report.selectedElement.tagName}\``,
      `- Text: ${escapeMarkdown(report.selectedElement.innerText)}`,
      `- Direct text nodes: ${report.selectedElement.directTextNodes.map(escapeMarkdown).join(" / ") || "none"}`,
      `- Display: ${report.selectedElement.computed.display}; visibility: ${report.selectedElement.computed.visibility}; opacity: ${report.selectedElement.computed.opacity}`,
      `- Rect: ${report.selectedElement.rect.width}×${report.selectedElement.rect.height} at ${report.selectedElement.rect.x}, ${report.selectedElement.rect.y}`,
      `- Parser results: \`${JSON.stringify(report.selectedElement.parserResults)}\``,
      "",
      "### Ancestors",
      "",
      "| Selector | Excluded | Reason |",
      "| --- | --- | --- |",
      ...report.selectedElement.ancestors.map((ancestor) =>
        `| \`${escapeMarkdown(ancestor.selector)}\` | ${ancestor.excluded ? "yes" : "no"} | ${escapeMarkdown(ancestor.exclusionReason ?? "")} |`
      ),
      ""
    );
  }

  lines.push(
    "## Visible price-like elements",
    "",
    "| Selector | Text | Split | Parser matches |",
    "| --- | --- | --- | --- |",
    ...report.priceLikeElements.map((element) =>
      `| \`${escapeMarkdown(element.selector)}\` | ${escapeMarkdown(element.text)} | ${element.splitAcrossNodes ? "yes" : "no"} | \`${escapeMarkdown(JSON.stringify(element.parserMatches))}\` |`
    ),
    "",
    "## Text-node pipeline",
    "",
    "| ID | Parent | Text | Scanner | Parser | Conversion | Renderer |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.textNodes.map((node) =>
      `| ${node.id} | \`${escapeMarkdown(node.parentSelector)}\` | ${escapeMarkdown(node.text)} | ${node.scanned ? "scanned" : `skip: ${escapeMarkdown(node.scanSkipReason ?? "unknown")}`} | ${node.parserAttempted ? escapeMarkdown(JSON.stringify(node.parserMatches)) : "not attempted"} | ${node.conversionRequested ? `requested; rate ${node.rateAvailable ? "available" : "missing"}` : `skip: ${escapeMarkdown(node.conversionSkipReason ?? "unknown")}`} | ${node.renderingAttempted ? "attempted" : `skip: ${escapeMarkdown(node.renderingSkipReason ?? "unknown")}`} |`
    ),
    "",
    "## Match-level DOM pipeline",
    "",
    "```json",
    JSON.stringify(
      report.textNodes.flatMap((node) =>
        node.matchDiagnostics.map((match) => ({ textNodeId: node.id, ...match }))
      ),
      null,
      2
    ),
    "```",
    "",
    "## Diagnostic events",
    "",
    "```json",
    JSON.stringify(report.diagnosticEvents, null, 2),
    "```",
    "",
    "## Mutation reconciliation batches",
    "",
    "```json",
    JSON.stringify(report.mutationBatches, null, 2),
    "```",
    "",
    "## Badge visibility and overlay decisions",
    "",
    "```json",
    JSON.stringify(report.badgeVisibility, null, 2),
    "```"
  );

  return lines.join("\n");
}
