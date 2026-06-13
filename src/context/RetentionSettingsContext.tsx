import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_SILENT_CHURN_THRESHOLD_DAYS,
  resolveSilentChurnThresholdDays,
} from '../lib/gym/silentChurn';

// Local Retention settings store. Follows the SidebarContext localStorage
// precedent — app-level, browser-local only. Deliberately SEPARATE from the
// CFO financial settings (WorkspaceSettings / sharedPersistence.ts, which is
// locked): no Supabase column, no migration, no shared row. The Silent Churn
// threshold is an owner-tunable operating judgment, persisted here so changing
// it in Settings reactively updates the Gym › Retention card.

type RetentionSettingsValue = {
  // Always a resolved, clamped value (1–365, default 21).
  silentChurnThresholdDays: number;
  setSilentChurnThresholdDays: (value: number) => void;
  // Option B "Include Unknown members" view toggle. DEFAULT OFF = every Retention
  // card expresses its rates over the attendance-known base (unresolved Unknown
  // excluded from denominators). ON flips all cards back to full-base. View-layer
  // only — it changes denominators/displayed rates, NEVER classification, so the
  // absolute Healthy/Watch/Silent/active/census counts are identical in both states.
  includeUnknown: boolean;
  setIncludeUnknown: (value: boolean) => void;
};

const RetentionSettingsContext = createContext<RetentionSettingsValue | null>(null);

const STORAGE_KEY = 'wx_retention_settings';

function readStoredThreshold(): number {
  if (typeof window === 'undefined') return DEFAULT_SILENT_CHURN_THRESHOLD_DAYS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SILENT_CHURN_THRESHOLD_DAYS;
    const parsed = JSON.parse(stored) as { silentChurnThresholdDays?: unknown };
    return resolveSilentChurnThresholdDays(parsed?.silentChurnThresholdDays);
  } catch {
    return DEFAULT_SILENT_CHURN_THRESHOLD_DAYS;
  }
}

// DEFAULT-OFF via absence: a brand-new browser (no blob), a blob missing the key
// (migration from the threshold-only era), or any non-boolean value all resolve
// to false. STRICT `=== true` so only an explicit stored `true` turns it on.
// Exported as a pure function so the default-OFF semantics are unit-testable
// without a DOM/localStorage harness.
export function parseIncludeUnknown(stored: string | null): boolean {
  if (!stored) return false;
  try {
    const parsed = JSON.parse(stored) as { includeUnknownInRetention?: unknown };
    return parsed?.includeUnknownInRetention === true;
  } catch {
    return false;
  }
}

function readStoredIncludeUnknown(): boolean {
  if (typeof window === 'undefined') return false;
  return parseIncludeUnknown(window.localStorage.getItem(STORAGE_KEY));
}

export function RetentionSettingsProvider({ children }: { children: ReactNode }) {
  const [silentChurnThresholdDays, setThreshold] = useState<number>(readStoredThreshold);
  const [includeUnknown, setIncludeUnknownState] = useState<boolean>(readStoredIncludeUnknown);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ silentChurnThresholdDays, includeUnknownInRetention: includeUnknown }),
      );
    } catch {
      // non-fatal — persistence is best-effort, the resolved value still drives the UI
    }
  }, [silentChurnThresholdDays, includeUnknown]);

  const setSilentChurnThresholdDays = useCallback((value: number) => {
    // Resolve on write so the store never holds an out-of-contract value.
    setThreshold(resolveSilentChurnThresholdDays(value));
  }, []);

  const setIncludeUnknown = useCallback((value: boolean) => {
    // Coerce to a strict boolean so the store never holds a truthy non-boolean.
    setIncludeUnknownState(value === true);
  }, []);

  const value = useMemo(
    () => ({
      silentChurnThresholdDays,
      setSilentChurnThresholdDays,
      includeUnknown,
      setIncludeUnknown,
    }),
    [silentChurnThresholdDays, setSilentChurnThresholdDays, includeUnknown, setIncludeUnknown],
  );

  return (
    <RetentionSettingsContext.Provider value={value}>
      {children}
    </RetentionSettingsContext.Provider>
  );
}

export function useRetentionSettings(): RetentionSettingsValue {
  const ctx = useContext(RetentionSettingsContext);
  if (!ctx) {
    throw new Error('useRetentionSettings must be used within a RetentionSettingsProvider');
  }
  return ctx;
}
