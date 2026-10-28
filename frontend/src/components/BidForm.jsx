import React, { useEffect, useState } from 'react';
import { listSuppliers, submitBid } from '../api.js';

const blank = {
  supplierId: '',
  carrierName: '',
  freightCharges: '',
  originCharges: '',
  destinationCharges: '',
  transitTimeDays: '',
  validUntil: '',
};

/**
 * Bid as a supplier.
 *
 * There is no login in this build, so the supplier is a dropdown. That is a
 * deliberate scope cut, not an oversight: authentication adds nothing to the
 * auction mechanics, and being able to switch supplier in one click is what
 * makes a rank change demonstrable by one person on one screen.
 */
export default function BidForm({ rfqId, onPlaced }) {
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSuppliers().then(setSuppliers).catch(() => {});
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const total =
    (Number(form.freightCharges) || 0) +
    (Number(form.originCharges) || 0) +
    (Number(form.destinationCharges) || 0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await submitBid(rfqId, {
        supplierId: form.supplierId,
        carrierName: form.carrierName,
        freightCharges: Number(form.freightCharges),
        originCharges: Number(form.originCharges),
        destinationCharges: Number(form.destinationCharges),
        transitTimeDays: Number(form.transitTimeDays),
        validUntil: new Date(form.validUntil).toISOString(),
      });
      setForm((f) => ({ ...blank, supplierId: f.supplierId, carrierName: f.carrierName }));
      onPlaced?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Submit a quote</h2>
      <p className="sub">
        A new quote replaces your previous one and must be lower than it.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="supplier">Supplier</label>
        <select id="supplier" value={form.supplierId} onChange={set('supplierId')} required>
          <option value="">Choose…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <label htmlFor="carrier">Carrier name</label>
        <input id="carrier" value={form.carrierName} onChange={set('carrierName')} required />

        <div className="row3">
          <div>
            <label htmlFor="freight">Freight</label>
            <input id="freight" type="number" step="0.01" min="0" value={form.freightCharges} onChange={set('freightCharges')} required />
          </div>
          <div>
            <label htmlFor="origin">Origin</label>
            <input id="origin" type="number" step="0.01" min="0" value={form.originCharges} onChange={set('originCharges')} required />
          </div>
          <div>
            <label htmlFor="dest">Destination</label>
            <input id="dest" type="number" step="0.01" min="0" value={form.destinationCharges} onChange={set('destinationCharges')} required />
          </div>
        </div>

        <div className="total-preview">
          Total <strong>{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
        </div>

        <div className="row2">
          <div>
            <label htmlFor="transit">Transit time (days)</label>
            <input id="transit" type="number" min="1" value={form.transitTimeDays} onChange={set('transitTimeDays')} required />
          </div>
          <div>
            <label htmlFor="valid">Quote valid until</label>
            <input id="valid" type="date" value={form.validUntil} onChange={set('validUntil')} required />
          </div>
        </div>

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit quote'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
