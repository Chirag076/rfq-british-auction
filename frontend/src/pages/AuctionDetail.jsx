import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAuction } from '../api.js';
import { useAuctionSocket } from '../components/useAuctionSocket.js';
import Countdown from '../components/Countdown.jsx';
import Loading from '../components/Loading.jsx';
import BidForm from '../components/BidForm.jsx';

const money = (n) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TRIGGER_LABEL = {
  BID_RECEIVED: 'Any bid received',
  ANY_RANK_CHANGE: 'Any supplier rank change',
  L1_CHANGE: 'Lowest bidder (L1) changes',
};

const EVENT_LABEL = {
  BID_PLACED: 'Bid',
  AUCTION_EXTENDED: 'Extended',
  EXTENSION_CAPPED: 'Capped',
  AUCTION_CLOSED: 'Closed',
};

export default function AuctionDetail() {
  const { id } = useParams();
  const [rfq, setRfq] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    getAuction(id).then(setRfq).catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);
  useAuctionSocket(id, load);

  if (error) return <p className="state error">{error}</p>;
  if (!rfq) return <Loading />;

  const open = rfq.status === 'ACTIVE';
  const ceilingReached = new Date(rfq.bidCloseAt).getTime() >= new Date(rfq.forcedCloseAt).getTime();

  return (
    <>
      <div className="bar">
        <div>
          <Link to="/" className="back">
            ← All auctions
          </Link>
          <h1>{rfq.reference}</h1>
          <p className="sub">{rfq.name}</p>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="label">Current lowest</div>
          <div className="value">{rfq.bids[0] ? money(rfq.bids[0].totalAmount) : '—'}</div>
          <div className="note">{rfq.bids[0]?.supplierName ?? 'no bids yet'}</div>
        </div>
        <div className="tile">
          <div className="label">Closes</div>
          <div className="value">
            {open ? <Countdown until={rfq.bidCloseAt} /> : <span className="count done">{rfq.status === 'FORCE_CLOSED' ? 'force closed' : 'closed'}</span>}
          </div>
          <div className="note">{new Date(rfq.bidCloseAt).toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Forced close</div>
          <div className="value small">{new Date(rfq.forcedCloseAt).toLocaleTimeString()}</div>
          <div className={`note${ceilingReached ? ' bad' : ''}`}>
            {ceilingReached ? 'ceiling reached, no more extensions' : 'extensions can never pass this'}
          </div>
        </div>
        <div className="tile">
          <div className="label">Extended so far</div>
          <div className="value">
            {rfq.extendedByMinutes}
            <span className="unit">min</span>
          </div>
          <div className="note">from {new Date(rfq.originalCloseAt).toLocaleTimeString()}</div>
        </div>
      </div>

      <div className="grid">
        <div>
          <section className="card">
            <h2>Supplier ranking</h2>
            <p className="sub">
              Lowest total wins. Each supplier has one live quote; a new one replaces it.
            </p>
            {rfq.bids.length === 0 ? (
              <p className="state">No bids yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Supplier</th>
                      <th>Carrier</th>
                      <th className="r">Freight</th>
                      <th className="r">Origin</th>
                      <th className="r">Destination</th>
                      <th className="r">Total</th>
                      <th className="r">Transit</th>
                      <th>Valid until</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.bids.map((b) => (
                      <tr key={b.id} className={b.rank === 'L1' ? 'leader' : undefined}>
                        <td>
                          <span className="rank">{b.rank}</span>
                        </td>
                        <td>{b.supplierName}</td>
                        <td className="muted">{b.carrierName}</td>
                        <td className="r muted">{money(b.freightCharges)}</td>
                        <td className="r muted">{money(b.originCharges)}</td>
                        <td className="r muted">{money(b.destinationCharges)}</td>
                        <td className="r">
                          <strong>{money(b.totalAmount)}</strong>
                        </td>
                        <td className="r muted">{b.transitTimeDays}d</td>
                        <td className="muted">{new Date(b.validUntil).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Activity log</h2>
            <p className="sub">
              Every bid and every extension, with the reason the rules gave at the time.
            </p>
            <ol className="log">
              {rfq.events.map((e) => (
                <li key={e.id} className={e.type.toLowerCase()}>
                  <span className={`tag ${e.type.toLowerCase()}`}>{EVENT_LABEL[e.type]}</span>
                  <div className="log-body">
                    <div>{e.reason}</div>
                    {e.newCloseAt && e.previousCloseAt && e.newCloseAt !== e.previousCloseAt && (
                      <div className="muted">
                        {new Date(e.previousCloseAt).toLocaleTimeString()} →{' '}
                        {new Date(e.newCloseAt).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                  <time className="muted">{new Date(e.createdAt).toLocaleTimeString()}</time>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div>
          <section className="card">
            <h2>Auction configuration</h2>
            <dl className="config">
              <dt>Extends on</dt>
              <dd>{TRIGGER_LABEL[rfq.config.trigger]}</dd>
              <dt>Trigger window (X)</dt>
              <dd>{rfq.config.triggerWindowMinutes} minutes before close</dd>
              <dt>Extension (Y)</dt>
              <dd>{rfq.config.extensionMinutes} minutes</dd>
              <dt>Bidding opened</dt>
              <dd>{new Date(rfq.bidStartAt).toLocaleString()}</dd>
              <dt>Pickup date</dt>
              <dd>{new Date(rfq.pickupDate).toLocaleDateString()}</dd>
            </dl>
          </section>

          {open && <BidForm rfqId={rfq.id} onPlaced={load} />}
        </div>
      </div>
    </>
  );
}
