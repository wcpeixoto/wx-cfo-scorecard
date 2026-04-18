export type SignalType =
  | 'reserve_critical'
  | 'reserve_warning'
  | 'cash_flow_negative'
  | 'cash_flow_tight'
  | 'expense_surge'
  | 'revenue_decline'
  | 'owner_distributions_high'
  | 'steady_state';

export type Severity = 'critical' | 'warning' | 'healthy';

export interface Signal {
  type: SignalType;
  severity: Severity;
  weight: number;
  metricValue?: number;
  targetValue?: number;
  gapAmount?: number;
  categoryFlagged?: string;
  recommendedAction?: string;
}

export interface RankedPriorities {
  hero: Signal;
  secondary: Signal[];
}

export interface PriorityHistoryRow {
  id?: string;
  workspace_id: string;
  fired_at: string;
  signal_type: SignalType;
  severity: Severity;
  metric_value?: number;
  target_value?: number;
  category_flagged?: string;
  gap_amount?: number;
  recommended_action?: string;
  ai_headline?: string;
  committed_action?: string;
  outcome_metric?: number;
  resolved_at?: string;
}
