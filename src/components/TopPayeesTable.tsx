import type { PayeeTotal } from '../lib/data/contract';

type TopPayeesTableProps = {
  payees: PayeeTotal[];
  subtitle?: string;
};

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export default function TopPayeesTable({
  payees,
  subtitle = 'Highest expense recipients this month',
}: TopPayeesTableProps) {
  return (
    <article className="card table-card">
      <div className="card-head">
        <h3>Top Payees</h3>
        <p className="subtle">{subtitle}</p>
      </div>

      {payees.length === 0 ? (
        <p className="empty-state">No payee data yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Payee</th>
              <th>Transactions</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {payees.map((row) => (
              <tr key={row.payee}>
                <td>{row.payee}</td>
                <td>{row.transactionCount}</td>
                <td>{formatCurrency(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
