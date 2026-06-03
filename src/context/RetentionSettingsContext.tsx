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

export function RetentionSettingsProvider({ children }: { children: ReactNode }) {
  const [silentChurnThresholdDays, setThreshold] = useState<number>(readStoredThreshold);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ silentChurnThresholdDays }),
      );
    } catch {
      // non-fatal — persistence is best-effort, the resolved value still drives the UI
    }
  }, [silentChurnThresholdDays]);

  const setSilentChurnThresholdDays = useCallback((value: number) => {
    // Resolve on write so the store never holds an out-of-contract value.
    setThreshold(resolveSilentChurnThresholdDays(value));
  }, []);

  const value = useMemo(
    () => ({ silentChurnThresholdDays, setSilentChurnThresholdDays }),
    [silentChurnThresholdDays, setSilentChurnThresholdDays],
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
