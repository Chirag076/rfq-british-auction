import React, { useEffect, useState } from 'react';

/**
 * Time remaining, ticking locally.
 *
 * Ticking in the browser rather than asking the server every second is the
 * difference between one request per client and sixty. The server stays
 * authoritative: the close time arrives over the socket, and when it moves the
 * countdown jumps, which is exactly the moment a supplier needs to notice.
 *
 * It deliberately shows the last minute in seconds. A supplier deciding whether
 * to bid in the trigger window cannot act on "1 minute left".
 */
export default function Countdown({ until, label, warnWithinSeconds = 120 }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return <span className="count done">{label ? `${label} ` : ''}elapsed</span>;

  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const text = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  const warn = total <= warnWithinSeconds;

  return (
    <span className={`count${warn ? ' warn' : ''}`}>
      {label ? `${label} ` : ''}
      {text}
    </span>
  );
}
