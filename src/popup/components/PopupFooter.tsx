import {
  formatIranianBridgeStatus,
  formatRateStatus,
  type CombinedRateStatus,
} from "../rateStatus";

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
  const [iranianMessage, ...iranianDetails] = iranianStatus
    ? formatIranianBridgeStatus(iranianStatus)
    : [];

  return (
    <footer className="grid gap-1 text-xs leading-4 text-muted-foreground">
      <div className="flex items-start gap-2" aria-label="Exchange rate status" aria-live="polite">
        <span
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${statusDotClass}`}
          aria-hidden="true"
        />
        <p>
          <span className="text-foreground">{message}</span>
          {details.length > 0 ? ` · ${details.join(" · ")}` : ""}
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
          <p>
            <span className="text-foreground">{iranianMessage}</span>
            {iranianDetails.length > 0 ? ` · ${iranianDetails.join(" · ")}` : ""}
          </p>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {showSaveStatus ? <p role="status" aria-live="polite">{saveStatus}</p> : null}
    </footer>
  );
}
