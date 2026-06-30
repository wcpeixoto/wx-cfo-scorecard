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
  // "Exclude parent/guardian accounts" view toggle. DEFAULT ON. The
  // attendance-recency "unknown" population (active accounts with no readable
  // class check-in — staff-confirmed parent/guardian billing accounts) is ALWAYS
  // held out of every retention rate denominator (the known base); this toggle is
  // DISPLAY-ONLY — it controls whether that population's count/tile/row/note is
  // shown in the in-scope cards. ON hides it (one quiet audit line discloses N);
  // OFF shows it as informational. It never reclassifies anyone and never changes
  // a denominator, so the absolute Healthy/Watch/Silent/active counts are
  // identical in both states. It does NOT affect Member Movement (whose unknown is
  // unrecognized client_status, a different population).
  excludeUnknownRecency: boolean;
  setExcludeUnknownRecency: (value: boolean) => void;
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

// DEFAULT-ON via absence: a brand-new browser (no blob), a blob missing the key
// (migration — including the legacy `includeUnknownInRetention`-only era, which is
// deliberately NOT read here so an old saved value can't flip this new toggle), a
// non-boolean value, or malformed JSON all resolve to TRUE. Only an explicit
// stored boolean `false` turns it off. A NEW key (`excludeUnknownRecency`) — never
// the old key — so existing users migrate cleanly to the default rather than
// inheriting an inverted meaning. Exported pure so the default-ON semantics are
// unit-testable without a DOM/localStorage harness.
export function parseExcludeUnknownRecency(stored: string | null): boolean {
  if (!stored) return true;
  try {
    const parsed = JSON.parse(stored) as { excludeUnknownRecency?: unknown };
    // Only a real boolean `false` opts out; everything else (absent / non-boolean) is ON.
    return parsed?.excludeUnknownRecency !== false;
  } catch {
    return true;
  }
}

function readStoredExcludeUnknownRecency(): boolean {
  if (typeof window === 'undefined') return true;
  return parseExcludeUnknownRecency(window.localStorage.getItem(STORAGE_KEY));
}

export function RetentionSettingsProvider({ children }: { children: ReactNode }) {
  const [silentChurnThresholdDays, setThreshold] = useState<number>(readStoredThreshold);
  const [excludeUnknownRecency, setExcludeUnknownRecencyState] = useState<boolean>(
    readStoredExcludeUnknownRecency,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Persist the NEW key only; the legacy `includeUnknownInRetention` is dropped
      // on the next write (we never read it, so this can't flip a user's state).
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ silentChurnThresholdDays, excludeUnknownRecency }),
      );
    } catch {
      // non-fatal — persistence is best-effort, the resolved value still drives the UI
    }
  }, [silentChurnThresholdDays, excludeUnknownRecency]);

  const setSilentChurnThresholdDays = useCallback((value: number) => {
    // Resolve on write so the store never holds an out-of-contract value.
    setThreshold(resolveSilentChurnThresholdDays(value));
  }, []);

  const setExcludeUnknownRecency = useCallback((value: boolean) => {
    // Coerce to a strict boolean so the store never holds a truthy non-boolean.
    setExcludeUnknownRecencyState(value === true);
  }, []);

  const value = useMemo(
    () => ({
      silentChurnThresholdDays,
      setSilentChurnThresholdDays,
      excludeUnknownRecency,
      setExcludeUnknownRecency,
    }),
    [silentChurnThresholdDays, setSilentChurnThresholdDays, excludeUnknownRecency, setExcludeUnknownRecency],
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
