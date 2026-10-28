import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createAuction } from '../api.js';

/** Local datetime string for an <input type="datetime-local"> N minutes from now. */
const inMinutes = (n) => {
  const d = new Date(Date.now() + n * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const initial = () => ({
  reference: `RFQ-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
  name: '',
  bidStartAt: inMinutes(0),
  bidCloseAt: inMinutes(10),
  forcedCloseAt: inMinutes(25),
  pickupDate: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  britishAuction: true,
  triggerWindowMinutes: 5,
  extensionMinutes: 3,
  trigger: 'L1_CHANGE',
});

export default function CreateRfq() {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setChecked = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.checked }));

  // Mirrors the server's invariant so the user is told before submitting rather
  // than after. The server still enforces it: a disabled button is not a rule.
  const forcedTooEarly = new Date(form.forcedCloseAt) <= new Date(form.bidCloseAt);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const rfq = await createAuction({
        ...form,
        bidStartAt: new Date(form.bidStartAt).toISOString(),
        bidCloseAt: new Date(form.bidCloseAt).toISOString(),
        forcedCloseAt: new Date(form.forcedCloseAt).toISOString(),
        pickupDate: new Date(form.pickupDate).toISOString(),
        triggerWindowMinutes: Number(form.triggerWindowMinutes),
        extensionMinutes: Number(form.extensionMinutes),
      });
      navigate(`/rfq/${rfq.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="bar">
        <div>
          <h1>New RFQ</h1>
          <p className="sub">Create a request for quotation with British-auction bidding.</p>
        </div>
      </div>

      <section className="card narrow">
        <form onSubmit={submit}>
          <div className="row2">
            <div>
              <label htmlFor="ref">Reference</label>
              <input id="ref" value={form.reference} onChange={set('reference')} required />
            </div>
            <div>
              <label htmlFor="name">RFQ name</label>
              <input id="name" value={form.name} onChange={set('name')} placeholder="Mumbai to Hamburg, 2x40ft" required />
            </div>
          </div>

          <h3>Timings</h3>
          <div className="row2">
            <div>
              <label htmlFor="start">Bid start</label>
              <input id="start" type="datetime-local" value={form.bidStartAt} onChange={set('bidStartAt')} required />
            </div>
            <div>
              <label htmlFor="close">Bid close</label>
              <input id="close" type="datetime-local" value={form.bidCloseAt} onChange={set('bidCloseAt')} required />
            </div>
          </div>
          <div className="row2">
            <div>
              <label htmlFor="forced">Forced bid close</label>
              <input id="forced" type="datetime-local" value={form.forcedCloseAt} onChange={set('forcedCloseAt')} required />
              {forcedTooEarly && (
                <p className="field-error">Must be later than the bid close time.</p>
              )}
            </div>
            <div>
              <label htmlFor="pickup">Pickup / service date</label>
              <input id="pickup" type="date" value={form.pickupDate} onChange={set('pickupDate')} required />
            </div>
          </div>

          <h3>British auction</h3>

          <label className="check">
            <input
              id="british"
              type="checkbox"
              checked={form.britishAuction}
              onChange={setChecked('britishAuction')}
            />
            <span>
              Run this RFQ as a British auction
              <em>
                Off means a plain RFQ: suppliers quote once, the close never moves, and the
                server refuses bids on it.
              </em>
            </span>
          </label>

          <label htmlFor="trigger">Extend when</label>
          <select id="trigger" value={form.trigger} onChange={set('trigger')} disabled={!form.britishAuction}>
            <option value="BID_RECEIVED">Any bid is received in the trigger window</option>
            <option value="ANY_RANK_CHANGE">Any supplier rank changes</option>
            <option value="L1_CHANGE">The lowest bidder (L1) changes</option>
          </select>

          <div className="row2">
            <div>
              <label htmlFor="x">Trigger window X (minutes)</label>
              <input id="x" type="number" min="1" value={form.triggerWindowMinutes} onChange={set('triggerWindowMinutes')} disabled={!form.britishAuction} required />
            </div>
            <div>
              <label htmlFor="y">Extension Y (minutes)</label>
              <input id="y" type="number" min="1" value={form.extensionMinutes} onChange={set('extensionMinutes')} disabled={!form.britishAuction} required />
            </div>
          </div>

          <p className="hint">
            {form.britishAuction
              ? `Activity in the last ${form.triggerWindowMinutes} minutes pushes the close out by ${form.extensionMinutes} minutes, never past the forced close.`
              : 'Extension settings do not apply: this RFQ closes at its bid close time.'}
          </p>

          <button type="submit" className="btn primary" disabled={busy || forcedTooEarly}>
            {busy ? 'Creating…' : 'Create auction'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </>
  );
}
