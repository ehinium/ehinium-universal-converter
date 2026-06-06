const DEBOUNCE_DELAY_MS = 500;

let stopActiveObserver: (() => void) | null = null;

export function observeDomChanges(callback: () => void): () => void {
  stopActiveObserver?.();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const observer = new MutationObserver(() => {
    if (stopped) {
      return;
    }

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      if (!stopped) {
        callback();
      }
    }, DEBOUNCE_DELAY_MS);
  });

  observer.observe(document, {
    childList: true,
    subtree: true,
  });

  const stop = (): void => {
    if (stopped) {
      return;
    }

    stopped = true;
    observer.disconnect();

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (stopActiveObserver === stop) {
      stopActiveObserver = null;
    }
  };

  stopActiveObserver = stop;
  return stop;
}
