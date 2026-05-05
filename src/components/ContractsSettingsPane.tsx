import { useMemo, useState } from 'react';
import type {
  RenewalContract,
  RenewalContractCadence,
  RenewalContractStatus,
} from '../lib/data/contract';

interface ContractsSettingsPaneProps {
  contracts: RenewalContract[];
  onCreate: (contract: RenewalContract) => Promise<void>;
  onUpdate: (contract: RenewalContract) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type Direction = 'revenue' | 'expense' | 'both';

interface FormState {
  name: string;
  direction: Direction;
  status: RenewalContractStatus;
  renewalDate: string;
  cadence: RenewalContractCadence;
  cashInAmount: string;
  cashOutAmount: string;
  enabled: boolean;
  notes: string;
}

interface FormErrors {
  name?: string;
  renewalDate?: string;
  amount?: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  direction: 'revenue',
  status: 'active',
  renewalDate: '',
  cadence: 'monthly',
  cashInAmount: '',
  cashOutAmount: '',
  enabled: true,
  notes: '',
};

function generateContractId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `contract_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function inferDirection(contract: RenewalContract): Direction {
  const hasIn = contract.cashInAmount > 0;
  const hasOut = contract.cashOutAmount > 0;
  if (hasIn && hasOut) return 'both';
  if (hasOut) return 'expense';
  return 'revenue';
}

function contractToForm(contract: RenewalContract): FormState {
  return {
    name: contract.name,
    direction: inferDirection(contract),
    status: contract.status,
    renewalDate: contract.renewalDate,
    cadence: contract.renewalCadence,
    cashInAmount: contract.cashInAmount > 0 ? String(contract.cashInAmount) : '',
    cashOutAmount: contract.cashOutAmount > 0 ? String(contract.cashOutAmount) : '',
    enabled: contract.enabled,
    notes: contract.notes ?? '',
  };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yStr, mStr, dStr] = value.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function formatRenewalDateDisplay(iso: string): string {
  if (!isValidIsoDate(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function statusLabel(status: RenewalContractStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function cadenceLabel(cadence: RenewalContractCadence): string {
  return cadence === 'monthly' ? 'Monthly' : 'Annual';
}

export default function ContractsSettingsPane({
  contracts,
  onCreate,
  onUpdate,
  onDelete,
}: ContractsSettingsPaneProps) {
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sortedContracts = useMemo(
    () =>
      [...contracts].sort((a, b) => {
        if (a.status !== b.status) {
          const order: Record<RenewalContractStatus, number> = {
            active: 0,
            paused: 1,
            ended: 2,
          };
          return order[a.status] - order[b.status];
        }
        return a.renewalDate.localeCompare(b.renewalDate);
      }),
    [contracts]
  );

  function openAddModal() {
    setEditingContractId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setShowFormModal(true);
  }

  function openEditModal(contract: RenewalContract) {
    setEditingContractId(contract.id);
    setForm(contractToForm(contract));
    setFormErrors({});
    setShowFormModal(true);
  }

  function closeModal() {
    setShowFormModal(false);
    setEditingContractId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
  }

  function validate(): FormErrors {
    const errors: FormErrors = {};
    if (!form.name.trim()) errors.name = 'Name is required.';
    if (!form.renewalDate) {
      errors.renewalDate = 'Choose the next renewal date.';
    } else if (!isValidIsoDate(form.renewalDate)) {
      errors.renewalDate = 'Enter a valid date.';
    }
    const cashIn = Number(form.cashInAmount) || 0;
    const cashOut = Number(form.cashOutAmount) || 0;
    if (form.direction === 'revenue' && cashIn <= 0) {
      errors.amount = 'Enter a Cash In amount greater than 0.';
    } else if (form.direction === 'expense' && cashOut <= 0) {
      errors.amount = 'Enter a Cash Out amount greater than 0.';
    } else if (form.direction === 'both' && cashIn <= 0 && cashOut <= 0) {
      errors.amount = 'Enter a Cash In or Cash Out amount greater than 0.';
    }
    return errors;
  }

  async function handleSubmit() {
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const cashIn = Number(form.cashInAmount) || 0;
    const cashOut = Number(form.cashOutAmount) || 0;

    // Direction is UI-only; map to the two persisted amount fields.
    const persistedCashIn = form.direction === 'expense' ? 0 : cashIn;
    const persistedCashOut = form.direction === 'revenue' ? 0 : cashOut;

    setSubmitting(true);
    try {
      if (editingContractId) {
        const existing = contracts.find((c) => c.id === editingContractId);
        const next: RenewalContract = {
          id: editingContractId,
          name: form.name.trim(),
          status: form.status,
          renewalDate: form.renewalDate,
          renewalCadence: form.cadence,
          cashInAmount: persistedCashIn,
          cashOutAmount: persistedCashOut,
          enabled: form.enabled,
          notes: form.notes.trim() || undefined,
          createdAt: existing?.createdAt,
          updatedAt: existing?.updatedAt,
        };
        await onUpdate(next);
      } else {
        const next: RenewalContract = {
          id: generateContractId(),
          name: form.name.trim(),
          status: form.status,
          renewalDate: form.renewalDate,
          renewalCadence: form.cadence,
          cashInAmount: persistedCashIn,
          cashOutAmount: persistedCashOut,
          enabled: form.enabled,
          notes: form.notes.trim() || undefined,
        };
        await onCreate(next);
      }
      closeModal();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelete(id: string) {
    setSubmitting(true);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } finally {
      setSubmitting(false);
    }
  }

  const showCashIn = form.direction === 'revenue' || form.direction === 'both';
  const showCashOut = form.direction === 'expense' || form.direction === 'both';

  return (
    <div className="ta-section">
      <div className="ta-section-header">
        <h2 className="ta-section-title">Contracts &amp; Renewals</h2>
      </div>
      <div className="ta-section-body">
        <div className="ta-card">
          <div className="ta-card-header contracts-card-header">
            <h3 className="ta-card-title">Recurring contracts</h3>
            <button
              type="button"
              className="event-modal-submit contracts-add-btn"
              onClick={openAddModal}
            >
              + Add Contract
            </button>
          </div>
          <div className="ta-card-body">
            {sortedContracts.length === 0 ? (
              <p className="contracts-empty">
                No contracts yet. Add a contract to generate recurring renewal
                events on the forecast.
              </p>
            ) : (
              <ul className="contracts-list">
                {sortedContracts.map((contract) => {
                  const dir = inferDirection(contract);
                  const isExpense = dir === 'expense';
                  const both = dir === 'both';
                  return (
                    <li key={contract.id} className="contracts-row">
                      <div className="contracts-row-main">
                        <div className="contracts-row-name-line">
                          <span className="contracts-row-name">
                            {contract.name}
                          </span>
                          <span
                            className={`contracts-status-badge is-${contract.status}`}
                          >
                            {statusLabel(contract.status)}
                          </span>
                          {!contract.enabled && (
                            <span className="contracts-status-badge is-disabled">
                              Disabled
                            </span>
                          )}
                        </div>
                        <div className="contracts-row-meta">
                          <span>{cadenceLabel(contract.renewalCadence)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Next: {formatRenewalDateDisplay(contract.renewalDate)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`contracts-row-amount${
                              isExpense ? ' is-out' : ''
                            }`}
                          >
                            {both
                              ? `+${formatCurrency(contract.cashInAmount)} / -${formatCurrency(contract.cashOutAmount)}`
                              : isExpense
                                ? `-${formatCurrency(contract.cashOutAmount)}`
                                : `+${formatCurrency(contract.cashInAmount)}`}
                          </span>
                        </div>
                      </div>
                      <div className="contracts-row-controls">
                        <button
                          type="button"
                          className="forecast-event-edit-btn"
                          onClick={() => openEditModal(contract)}
                          aria-label={`Edit ${contract.name}`}
                        >
                          ✎
                        </button>
                        {confirmDeleteId === contract.id ? (
                          <>
                            <button
                              type="button"
                              className="forecast-event-delete-confirm-yes"
                              onClick={() => handleConfirmDelete(contract.id)}
                              disabled={submitting}
                            >
                              Delete contract
                            </button>
                            <button
                              type="button"
                              className="forecast-event-delete-confirm-cancel"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={submitting}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="forecast-event-delete-btn"
                            onClick={() => setConfirmDeleteId(contract.id)}
                            aria-label={`Delete ${contract.name}`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {confirmDeleteId === contract.id && (
                        <div className="contracts-delete-helper">
                          Delete this contract? All generated renewal events
                          for this contract will be removed.
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {showFormModal && (
        <div
          className="event-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={editingContractId ? 'Edit Contract' : 'Add Contract'}
        >
          <div className="event-modal-panel contracts-modal-panel">
            <div className="event-modal-header">
              <h3 className="event-modal-title">
                {editingContractId ? 'Edit Contract' : 'Add Contract'}
              </h3>
            </div>
            <div className="event-modal-body">
              {/* Name */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="contract-name">
                  Name
                </label>
                <input
                  id="contract-name"
                  type="text"
                  className="event-form-input"
                  placeholder="e.g. Membership platform subscription"
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, name: e.target.value }));
                    setFormErrors((p) => ({ ...p, name: undefined }));
                  }}
                />
                {formErrors.name && (
                  <span className="event-form-error">{formErrors.name}</span>
                )}
              </div>

              {/* Direction */}
              <div className="event-form-field">
                <label className="event-form-label">Direction</label>
                <div className="segmented-toggle contracts-segmented">
                  {(['revenue', 'expense', 'both'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`segmented-toggle-btn${form.direction === d ? ' is-active' : ''}`}
                      onClick={() => {
                        setForm((p) => ({ ...p, direction: d }));
                        setFormErrors((p) => ({ ...p, amount: undefined }));
                      }}
                    >
                      {d === 'revenue' ? 'Revenue' : d === 'expense' ? 'Expense' : 'Both'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="event-form-field">
                <label className="event-form-label">Status</label>
                <div className="segmented-toggle contracts-segmented">
                  {(['active', 'paused', 'ended'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`segmented-toggle-btn${form.status === s ? ' is-active' : ''}`}
                      onClick={() => setForm((p) => ({ ...p, status: s }))}
                    >
                      {statusLabel(s)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Renewal date */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="contract-date">
                  Next renewal date
                </label>
                <input
                  id="contract-date"
                  type="date"
                  className="event-form-input"
                  value={form.renewalDate}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, renewalDate: e.target.value }));
                    setFormErrors((p) => ({ ...p, renewalDate: undefined }));
                  }}
                />
                <span className="event-form-helper">
                  Enter the next upcoming renewal. The generator emits forward
                  from this date.
                </span>
                {formErrors.renewalDate && (
                  <span className="event-form-error">
                    {formErrors.renewalDate}
                  </span>
                )}
              </div>

              {/* Cadence */}
              <div className="event-form-field">
                <label className="event-form-label">Cadence</label>
                <div className="segmented-toggle contracts-segmented">
                  {(['monthly', 'annual'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`segmented-toggle-btn${form.cadence === c ? ' is-active' : ''}`}
                      onClick={() => setForm((p) => ({ ...p, cadence: c }))}
                    >
                      {cadenceLabel(c)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash In / Cash Out */}
              {(showCashIn || showCashOut) && (
                <div className="event-form-row">
                  {showCashIn && (
                    <div className="event-form-field">
                      <label
                        className="event-form-label"
                        htmlFor="contract-cash-in"
                      >
                        Cash In ($)
                      </label>
                      <input
                        id="contract-cash-in"
                        type="number"
                        min="0"
                        step="0.01"
                        className="event-form-input"
                        placeholder="0"
                        value={form.cashInAmount}
                        onChange={(e) => {
                          setForm((p) => ({ ...p, cashInAmount: e.target.value }));
                          setFormErrors((p) => ({ ...p, amount: undefined }));
                        }}
                      />
                    </div>
                  )}
                  {showCashOut && (
                    <div className="event-form-field">
                      <label
                        className="event-form-label"
                        htmlFor="contract-cash-out"
                      >
                        Cash Out ($)
                      </label>
                      <input
                        id="contract-cash-out"
                        type="number"
                        min="0"
                        step="0.01"
                        className="event-form-input"
                        placeholder="0"
                        value={form.cashOutAmount}
                        onChange={(e) => {
                          setForm((p) => ({ ...p, cashOutAmount: e.target.value }));
                          setFormErrors((p) => ({ ...p, amount: undefined }));
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {formErrors.amount && (
                <span className="event-form-error">{formErrors.amount}</span>
              )}

              {/* Enabled */}
              <div className="event-form-field">
                <label className="contracts-enabled-row">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, enabled: e.target.checked }))
                    }
                  />
                  <span>Enabled</span>
                </label>
                <span className="event-form-helper">
                  When disabled, generated renewal events are excluded from
                  the forecast overlay.
                </span>
              </div>

              {/* Notes */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="contract-notes">
                  Notes (optional)
                </label>
                <textarea
                  id="contract-notes"
                  className="event-form-input contracts-notes-input"
                  rows={3}
                  maxLength={500}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, notes: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="event-modal-footer">
              <button
                type="button"
                className="event-modal-cancel"
                onClick={closeModal}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="event-modal-submit"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {editingContractId ? 'Save Changes' : 'Add Contract'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
