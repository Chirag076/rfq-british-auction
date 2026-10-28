import { useEffect } from 'react';
import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_BASE || undefined;

/**
 * One socket for the app, shared by every hook that needs it.
 *
 * A socket per component sounds tidy and is not: opening a second connection
 * for the countdown and a third for the bid list triples the handshakes and
 * makes the server's room bookkeeping meaningless.
 */
let socket;
function connection() {
  if (!socket) socket = io(URL, { transports: ['websocket', 'polling'] });
  return socket;
}

/** Re-run `onChange` whenever this auction moves. Pass no id to watch the list. */
export function useAuctionSocket(rfqId, onChange) {
  useEffect(() => {
    const s = connection();
    const event = rfqId ? 'auction:changed' : 'auctions:changed';

    if (rfqId) s.emit('watch', rfqId);
    s.on(event, onChange);

    return () => {
      s.off(event, onChange);
      if (rfqId) s.emit('unwatch', rfqId);
    };
  }, [rfqId, onChange]);
}
