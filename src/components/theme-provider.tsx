import {
  createElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  getThemePreference,
  resolveTheme,
  saveThemePreference,
  subscribeToThemePreferenceChanges,
} from "../services/theme";
import type { ThemePreference } from "../types/theme";
import { ThemeContext, type ThemeContextValue } from "./theme-context";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

type ThemeProviderProps = {
  children: ReactNode;
};

function getSystemThemeQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === "function"
      ? window.matchMedia(SYSTEM_THEME_QUERY)
      : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return getSystemThemeQuery()?.matches ?? false;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreference] = useState<ThemePreference>(
    DEFAULT_THEME_PREFERENCE
  );
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const resolvedTheme = resolveTheme(preference, prefersDark);

  useEffect(() => {
    let cancelled = false;
    let receivedStorageChange = false;

    const unsubscribe = subscribeToThemePreferenceChanges((nextPreference) => {
      receivedStorageChange = true;
      setPreference(nextPreference);
    });

    void getThemePreference().then((storedPreference) => {
      if (!cancelled && !receivedStorageChange) {
        setPreference(storedPreference);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (preference !== "system") {
      return;
    }

    const mediaQuery = getSystemThemeQuery();
    if (!mediaQuery) {
      return;
    }

    const updateSystemTheme = (event?: MediaQueryListEvent): void => {
      setPrefersDark(event?.matches ?? mediaQuery.matches);
    };

    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);

    return () => {
      mediaQuery.removeEventListener("change", updateSystemTheme);
    };
  }, [preference]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const updateThemePreference = useCallback(
    async (nextPreference: ThemePreference): Promise<boolean> => {
      setPreference(nextPreference);
      return saveThemePreference(nextPreference);
    },
    []
  );

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setThemePreference: updateThemePreference,
    }),
    [preference, resolvedTheme, updateThemePreference]
  );

  return createElement(ThemeContext.Provider, { value: contextValue }, children);
}
