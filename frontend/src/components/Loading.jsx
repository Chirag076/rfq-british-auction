import React, { useEffect, useState } from 'react';

/**
 * Loading state that explains itself if it takes too long.
 *
 * The hosted demo runs on a free instance that sleeps after 15 minutes idle
 * and takes about a minute to wake. Without this, the first visitor of the day
 * sees a spinner that looks broken and leaves.
 */
export default function Loading({ slowAfterMs = 4000 }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(id);
  }, [slowAfterMs]);

  return (
    <p className="state">
      Loading…
      {slow && (
        <span className="state-note">
          The API is on a free instance that sleeps when idle. The first request after a quiet
          spell wakes it, which takes about a minute.
        </span>
      )}
    </p>
  );
}
