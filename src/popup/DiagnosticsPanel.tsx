import { useEffect, useState } from "react";
import type { DiagnosticsMessage } from "../shared/messages";
import type { PageDiagnosticReport } from "../types/diagnostics";
import { formatPageDiagnosticMarkdown } from "./diagnosticMarkdown";

type DiagnosticsResponse = {
  ok: boolean;
  report?: PageDiagnosticReport | null;
  started?: boolean;
  error?: string;
};

async function sendToActiveTab(
  message: DiagnosticsMessage
): Promise<DiagnosticsResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    throw new Error("No active webpage tab is available.");
  }

  const response = await chrome.tabs.sendMessage(tab.id, message) as DiagnosticsResponse | undefined;
  if (!response?.ok) {
    throw new Error(response?.error ?? "The page diagnostics content script did not respond.");
  }
  return response;
}

function downloadReport(report: PageDiagnosticReport): void {
  const timestamp = report.timestamp.replaceAll(":", "-");
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `euc-page-diagnostics-${report.scope}-${timestamp}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function DiagnosticsPanel() {
  const [report, setReport] = useState<PageDiagnosticReport | null>(null);
  const [status, setStatus] = useState("No diagnostic capture in this tab.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void sendToActiveTab({ type: "diagnostics:get-report" })
      .then((response) => {
        if (!cancelled && response.report) {
          setReport(response.report);
          setStatus(`${response.report.scope} report captured at ${new Date(response.report.timestamp).toLocaleTimeString()}.`);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function capturePage(): Promise<void> {
    setBusy(true);
    setStatus("Capturing production pipeline diagnostics…");
    try {
      const response = await sendToActiveTab({ type: "diagnostics:capture-page" });
      setReport(response.report ?? null);
      setStatus(response.report
        ? `Captured ${response.report.summary.scannedTextNodeCount} scanned text nodes and ${response.report.summary.priceLikeElementCount} price-like elements.`
        : "Capture completed without a report.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startPicker(): Promise<void> {
    try {
      await sendToActiveTab({ type: "diagnostics:start-picker" });
      setStatus("Picker active. Move to the page and click a visible price, then reopen the popup.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyMarkdown(): Promise<void> {
    if (!report) return;
    await navigator.clipboard.writeText(formatPageDiagnosticMarkdown(report));
    setStatus("Markdown diagnostic report copied.");
  }

  async function clearSession(): Promise<void> {
    try {
      await sendToActiveTab({ type: "diagnostics:clear" });
      setReport(null);
      setStatus("Diagnostic session cleared.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section
      className="popup-block diagnostics-panel"
      aria-labelledby="diagnostics-title"
      style={{ display: "grid", gap: 12, background: "#f7f5ff" }}
    >
      <div className="section-heading">
        <h2 id="diagnostics-title">Development diagnostics</h2>
        <p>Capture why visible prices were scanned, parsed, converted, skipped, or not rendered.</p>
      </div>
      <div
        className="diagnostics-actions"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
      >
        <button className="button button--secondary" type="button" disabled={busy} onClick={() => void capturePage()}>
          {busy ? "Capturing…" : "Capture current page"}
        </button>
        <button className="button button--secondary" type="button" onClick={() => void startPicker()}>
          Pick element to inspect
        </button>
        <button className="button button--secondary" type="button" disabled={!report} onClick={() => report && downloadReport(report)}>
          Download diagnostic JSON
        </button>
        <button className="button button--secondary" type="button" disabled={!report} onClick={() => void copyMarkdown()}>
          Copy Markdown report
        </button>
        <button
          className="button button--secondary diagnostics-clear"
          type="button"
          style={{ gridColumn: "1 / -1" }}
          onClick={() => void clearSession()}
        >
          Clear diagnostic session
        </button>
      </div>
      <p
        className="diagnostics-status"
        role="status"
        aria-live="polite"
        style={{ margin: 0, color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.45 }}
      >
        {status}
      </p>
    </section>
  );
}
