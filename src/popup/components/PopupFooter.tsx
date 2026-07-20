import {
  formatIranianBridgeStatus,
  formatRateStatus,
  type CombinedRateStatus,
} from "../rateStatus";

function getIranianStatusLines(
  status: NonNullable<CombinedRateStatus["iranianBridgeStatus"]>
): [string, string?] {
  if (status.state === "fresh" || status.state === "stale") {
    const [, freshDetails = ""] = formatIranianBridgeStatus({
      ...status,
      state: "fresh",
    });
    const updated = freshDetails.split(" · ").at(-1) ?? "Updated time unavailable";
    return [updated, status.state === "stale" ? "Cached Ehinium source" : "Ehinium source"];
  }

  if (status.state === "loading") return ["Loading Iranian rate..."];
  if (status.state === "unavailable") return ["Iranian rate unavailable"];
  if (status.state === "misconfigured") return ["Iranian rate configuration unavailable"];
  return [""];
}

type PopupFooterProps = {
  rateStatus: CombinedRateStatus;
  error: string | null;
  showSaveStatus: boolean;
  saveStatus: string;
};

export function PopupFooter({
  rateStatus,
  error,
  showSaveStatus,
  saveStatus,
}: PopupFooterProps) {
  const [message, ...details] = formatRateStatus(rateStatus);
  const hasRateError = rateStatus.lastErrorAt !== null;
  const statusDotClass = hasRateError
    ? "bg-destructive"
    : rateStatus.response
      ? "bg-success"
      : "bg-muted-foreground";
  const iranianStatus = rateStatus.iranianBridgeStatus;
  const [iranianMessage, iranianDetail] = iranianStatus
    ? getIranianStatusLines(iranianStatus)
    : [""];

  return (
    <footer className="grid gap-1 text-xs leading-4 text-muted-foreground">
      <div className="flex items-start gap-2" aria-label="Exchange rate status" aria-live="polite">
        <span
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${statusDotClass}`}
          aria-hidden="true"
        />
        <p className="min-w-0">
          <span className="block text-foreground">{message}</span>
          {details.length > 0 ? (
            <span className="block text-muted-foreground">{details.join(" · ")}</span>
          ) : null}
        </p>
      </div>
      {iranianMessage ? (
        <div className="flex items-start gap-2" aria-label="Iranian rate status" aria-live="polite">
          <span
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
              iranianStatus?.state === "unavailable" || iranianStatus?.state === "misconfigured"
                ? "bg-destructive"
                : iranianStatus?.state === "fresh" || iranianStatus?.state === "stale"
                  ? "bg-success"
                  : "bg-muted-foreground"
            }`}
            aria-hidden="true"
          />
          <p className="min-w-0">
            <span className="block text-foreground">{iranianMessage}</span>
            {iranianDetail ? (
              <span className="block text-muted-foreground">{iranianDetail}</span>
            ) : null}
          </p>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {showSaveStatus ? <p role="status" aria-live="polite">{saveStatus}</p> : null}
    </footer>
  );
}
