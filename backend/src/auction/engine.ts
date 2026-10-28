/**
 * The auction rules, as pure functions.
 *
 * No database, no clock, no framework. Everything here takes its inputs
 * explicitly and returns a decision, which means the rules can be tested
 * exhaustively in milliseconds and read by someone who has never seen NestJS.
 *
 * The rules themselves are small. What makes them worth isolating is that they
 * are easy to get subtly wrong and the mistakes are invisible: an auction that
 * extends one minute past its forced close, or fails to extend on the bid that
 * mattered, looks exactly like one that worked.
 */

export type ExtensionTrigger = 'BID_RECEIVED' | 'ANY_RANK_CHANGE' | 'L1_CHANGE';

/** A supplier's live quote: their standing price in the auction. */
export interface Quote {
  supplierId: string;
  /** freight + origin + destination, in minor-unit-safe decimal string or number. */
  totalAmount: number;
  placedAt: Date;
}

export interface AuctionConfig {
  /** X: minutes before the close during which activity can extend it. */
  triggerWindowMinutes: number;
  /** Y: minutes added by one extension. */
  extensionMinutes: number;
  trigger: ExtensionTrigger;
}

export interface ExtensionDecision {
  extend: boolean;
  /** Where the close moves to. Equal to the current close when extend is false. */
  newCloseAt: Date;
  /** Written into the activity log verbatim. */
  reason: string;
  /**
   * True when a trigger fired but the clock could not move because the forced
   * close was already reached. Distinct from "nothing happened": the bid DID
   * qualify, and the auction is about to be force-closed. Collapsing the two
   * would lose the only signal that tells CLOSED apart from FORCE_CLOSED.
   */
  capped: boolean;
}

// --------------------------------------------------------------------- ranking

/**
 * Suppliers ordered by price, cheapest first. Index 0 is L1.
 *
 * Ties break on who got there first. Without that rule the ranking is
 * non-deterministic for equal bids, which would make "the ranking changed"
 * fire at random — and in a reverse auction equal bids are common, because
 * suppliers undercut to round numbers.
 */
export function rank(quotes: Quote[]): string[] {
  return [...quotes]
    .sort((a, b) =>
      a.totalAmount !== b.totalAmount
        ? a.totalAmount - b.totalAmount
        : a.placedAt.getTime() - b.placedAt.getTime(),
    )
    .map((q) => q.supplierId);
}

/** L1, L2, L3… as a map, for display. */
export function rankLabels(quotes: Quote[]): Map<string, string> {
  const order = rank(quotes);
  return new Map(order.map((supplierId, i) => [supplierId, `L${i + 1}`]));
}

// ------------------------------------------------------------- trigger window

/**
 * Is `now` inside the last X minutes before the close?
 *
 * Half-open on purpose: the window includes its start instant and excludes the
 * close itself. A bid landing exactly at the close is not a late bid, it is a
 * bid at a closed auction, and it is rejected earlier.
 */
export function inTriggerWindow(now: Date, closeAt: Date, triggerWindowMinutes: number): boolean {
  const windowOpensAt = closeAt.getTime() - triggerWindowMinutes * 60_000;
  return now.getTime() >= windowOpensAt && now.getTime() < closeAt.getTime();
}

// ------------------------------------------------------------ the trigger test

/**
 * Did this bid do the kind of thing the configured trigger cares about?
 *
 * Takes the ranking either side of the bid rather than the bid itself, because
 * two of the three triggers are about movement, not about the bid in isolation.
 */
export function triggerFired(
  trigger: ExtensionTrigger,
  rankingBefore: string[],
  rankingAfter: string[],
): { fired: boolean; reason: string } {
  switch (trigger) {
    case 'BID_RECEIVED':
      return { fired: true, reason: 'a bid was received inside the trigger window' };

    case 'ANY_RANK_CHANGE': {
      // A new supplier joining at the bottom changes the array length but not
      // the order of anyone already ranked. Comparing the common prefix keeps
      // "the ranking changed" meaning what a buyer would think it means.
      const common = Math.min(rankingBefore.length, rankingAfter.length);
      for (let i = 0; i < common; i += 1) {
        if (rankingBefore[i] !== rankingAfter[i]) {
          return {
            fired: true,
            reason: `supplier ranking changed at position L${i + 1} inside the trigger window`,
          };
        }
      }
      return { fired: false, reason: 'ranking was unchanged' };
    }

    case 'L1_CHANGE': {
      const before = rankingBefore[0];
      const after = rankingAfter[0];
      if (before !== after) {
        return {
          fired: true,
          reason: before
            ? 'the lowest bidder (L1) changed inside the trigger window'
            : 'the first bid set the lowest bidder (L1) inside the trigger window',
        };
      }
      return { fired: false, reason: 'the lowest bidder was unchanged' };
    }
  }
}

// ------------------------------------------------------------- the decision

/**
 * Should the auction extend, and to when?
 *
 * The order of the checks is the specification, so it is worth reading as one:
 *
 *   1. outside the trigger window        -> nothing happens
 *   2. inside, but the trigger did not fire -> nothing happens
 *   3. fired, room to move               -> extend by Y, clamped to forced close
 *   4. fired, no room                    -> capped; the auction is force-closed
 *
 * Step 3 clamps rather than refuses. Extending to 6:03 when the forced close is
 * 6:03 and Y would reach 6:05 is still an extension, and refusing it would cut
 * two minutes of legitimate bidding that the buyer configured for.
 */
export function decideExtension(params: {
  now: Date;
  bidCloseAt: Date;
  forcedCloseAt: Date;
  config: AuctionConfig;
  rankingBefore: string[];
  rankingAfter: string[];
}): ExtensionDecision {
  const { now, bidCloseAt, forcedCloseAt, config, rankingBefore, rankingAfter } = params;

  if (!inTriggerWindow(now, bidCloseAt, config.triggerWindowMinutes)) {
    return {
      extend: false,
      newCloseAt: bidCloseAt,
      reason: `bid placed outside the ${config.triggerWindowMinutes}-minute trigger window`,
      capped: false,
    };
  }

  const { fired, reason } = triggerFired(config.trigger, rankingBefore, rankingAfter);
  if (!fired) {
    return { extend: false, newCloseAt: bidCloseAt, reason, capped: false };
  }

  const wanted = new Date(bidCloseAt.getTime() + config.extensionMinutes * 60_000);
  const clamped = wanted.getTime() > forcedCloseAt.getTime() ? forcedCloseAt : wanted;

  // Already sitting on the ceiling: the trigger fired but there is nowhere to go.
  if (clamped.getTime() <= bidCloseAt.getTime()) {
    return {
      extend: false,
      newCloseAt: bidCloseAt,
      reason: `${reason}, but the forced close time has been reached so the auction cannot extend further`,
      capped: true,
    };
  }

  const trimmed = clamped.getTime() < wanted.getTime();
  return {
    extend: true,
    newCloseAt: clamped,
    reason: trimmed
      ? `${reason}; extended to the forced close time (a full ${config.extensionMinutes} minutes would have passed it)`
      : `${reason}; extended by ${config.extensionMinutes} minutes`,
    capped: false,
  };
}

// ------------------------------------------------------------------ validation

/** The one rule in the brief that is stated as an invariant rather than a feature. */
export function validateCloseTimes(params: {
  bidStartAt: Date;
  bidCloseAt: Date;
  forcedCloseAt: Date;
}): string[] {
  const errors: string[] = [];
  if (params.bidCloseAt <= params.bidStartAt) {
    errors.push('Bid close time must be after the bid start time.');
  }
  if (params.forcedCloseAt <= params.bidCloseAt) {
    errors.push('Forced bid close time must be later than the bid close time.');
  }
  return errors;
}
