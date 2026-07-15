import type { ReactNode, RefObject } from "react";
import type { ManualConversionResult } from "../../services/selectedTextConverter";
import type { ManualFeedback } from "../manualFeedback";

export type ManualConverterProps = {
  value: string;
  result: ManualConversionResult | null;
  feedback: ManualFeedback;
  isConverting: boolean;
  disabled: boolean;
  copyLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
  onPaste: () => void;
  onCopy: () => void;
};

export function ManualConverter({
  value,
  result,
  feedback,
  isConverting,
  disabled,
  copyLabel,
  inputRef,
  onChange,
  onBlur,
  onPaste,
  onCopy,
}: ManualConverterProps) {
  const isInvalid = !disabled && !isConverting && !result && feedback.invalid;
  let state: ReactNode;

  if (disabled) {
    state = <p className="manual-state">Enable conversions to use this tool.</p>;
  } else if (result) {
    state = (
      <div className="manual-result">
        <span className="manual-result-copy">
          <span className="manual-source">{result.source}</span>
          <output className="manual-converted" htmlFor="manual-conversion-input">
            {result.converted}
          </output>
        </span>
        <button className="button button--secondary" type="button" onClick={onCopy}>
          {copyLabel}
        </button>
      </div>
    );
  } else if (isConverting) {
    state = <p className="manual-state">Converting…</p>;
  } else {
    state = (
      <p
        className={`manual-state${
          feedback.tone === "error" ? " manual-state--error" : ""
        }`}
      >
        {feedback.message}
      </p>
    );
  }

  return (
    <div className="manual-converter">
      <label className="input-label" htmlFor="manual-conversion-input">
        Value to convert
      </label>
      <input
        ref={inputRef}
        id="manual-conversion-input"
        className="text-control"
        type="text"
        value={value}
        disabled={disabled}
        aria-invalid={isInvalid}
        aria-describedby="manual-conversion-state"
        placeholder="Enter 100 EUR or 180 cm"
        autoComplete="off"
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={(event) => onBlur(event.currentTarget.value)}
        onPaste={onPaste}
      />
      <div id="manual-conversion-state" className="manual-state-region" aria-live="polite">
        {state}
      </div>
    </div>
  );
}
