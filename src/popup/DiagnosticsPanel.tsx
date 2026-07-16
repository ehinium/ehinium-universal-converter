import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
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
      className="diagnostics-panel grid gap-3"
      aria-labelledby="diagnostics-title"
    >
      <div>
        <h2 id="diagnostics-title" className="text-[13px] font-medium leading-5 text-foreground">Development diagnostics</h2>
        <p className="text-xs leading-4 text-muted-foreground">Capture why visible prices were scanned, parsed, converted, skipped, or not rendered.</p>
      </div>
      <div className="diagnostics-actions grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void capturePage()}>
          {busy ? "Capturing…" : "Capture current page"}
        </Button>
        <Button variant="outline" size="sm" type="button" onClick={() => void startPicker()}>
          Pick element to inspect
        </Button>
        <Button variant="outline" size="sm" type="button" disabled={!report} onClick={() => report && downloadReport(report)}>
          Download diagnostic JSON
        </Button>
        <Button variant="outline" size="sm" type="button" disabled={!report} onClick={() => void copyMarkdown()}>
          Copy Markdown report
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="diagnostics-clear col-span-2"
          type="button"
          onClick={() => void clearSession()}
        >
          Clear diagnostic session
        </Button>
      </div>
      <p
        className="diagnostics-status m-0 text-xs leading-4 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
    </section>
  );
}
