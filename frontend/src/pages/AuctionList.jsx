import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAuctions, resetDemo } from '../api.js';
import { useAuctionSocket } from '../components/useAuctionSocket.js';
import Countdown from '../components/Countdown.jsx';
import Loading from '../components/Loading.jsx';

const money = (n) =>
  n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TRIGGER_LABEL = {
  BID_RECEIVED: 'any bid',
  ANY_RANK_CHANGE: 'any rank change',
  L1_CHANGE: 'L1 change',
};

function StatusPill({ status }) {
  const cls = {
    SCHEDULED: 'pill scheduled',
    ACTIVE: 'pill active',
    CLOSED: 'pill closed',
    FORCE_CLOSED: 'pill forced',
  }[status];
  const text = { SCHEDULED: 'Scheduled', ACTIVE: 'Active', CLOSED: 'Closed', FORCE_CLOSED: 'Force closed' }[status];
  return <span className={cls}>{text}</span>;
}

export default function AuctionList() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);

  const load = useCallback(() => {
    listAuctions().then(setRows).catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);
  useAuctionSocket(null, load);

  // The interesting auction closes five minutes after the data is seeded, which
  // on a deployed instance means five minutes after the deploy. This puts a
  // fresh one in front of whoever opens the link.
  const reset = async () => {
    if (!window.confirm('Replace all auctions with fresh demo data?')) return;
    setResetting(true);
    setError('');
    try {
      await resetDemo();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setResetting(false);
    }
  };

  if (error) return <p className="state error">{error}</p>;
  if (!rows) return <Loading />;

  return (
    <>
      <div className="bar">
        <div>
          <h1>British auctions</h1>
          <p className="sub">
            Reverse auctions: suppliers bid down, lowest wins. Bidding near the close extends the
            clock, up to a forced ceiling that never moves.
          </p>
        </div>
        <div className="bar-actions">
          <button className="btn" onClick={reset} disabled={resetting} type="button">
            {resetting ? 'Resetting…' : 'Reset demo data'}
          </button>
          <Link className="btn primary" to="/new">
            New RFQ
          </Link>
        </div>
      </div>

      {rows.length === 0 && <p className="state">No auctions yet. Create one to get started.</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>RFQ</th>
              <th>Status</th>
              <th className="r">Lowest bid</th>
              <th className="r">Bids</th>
              <th>Closes</th>
              <th>Forced close</th>
              <th>Extends on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/rfq/${r.id}`} className="ref">
                    {r.reference}
                  </Link>
                  <div className="muted">{r.name}</div>
                </td>
                <td>
                  <StatusPill status={r.status} />
                </td>
                <td className="r">
                  {r.lowestBid ? (
                    <>
                      <strong>{money(r.lowestBid.totalAmount)}</strong>
                      <div className="muted">{r.lowestBid.supplierName}</div>
                    </>
                  ) : (
                    <span className="muted">no bids</span>
                  )}
                </td>
                <td className="r">{r.bidCount}</td>
                <td>
                  {r.status === 'ACTIVE' ? (
                    <Countdown until={r.bidCloseAt} />
                  ) : (
                    <span className="muted">{new Date(r.bidCloseAt).toLocaleString()}</span>
                  )}
                  {r.bidCloseAt !== r.originalCloseAt && (
                    <div className="muted">
                      extended{' '}
                      {Math.round(
                        (new Date(r.bidCloseAt) - new Date(r.originalCloseAt)) / 60000,
                      )}{' '}
                      min
                    </div>
                  )}
                </td>
                <td className="muted">{new Date(r.forcedCloseAt).toLocaleString()}</td>
                <td className="muted">
                  {r.britishAuction === false ? (
                    'not a British auction'
                  ) : (
                    <>
                      {TRIGGER_LABEL[r.trigger]}
                      <div>
                        X {r.triggerWindowMinutes}m · Y {r.extensionMinutes}m
                      </div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
