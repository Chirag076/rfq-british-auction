/**
 * Tests for the auction rules.
 *
 * Two groups matter more than the rest. The forced-close tests exist because
 * that is the one hard invariant in the brief: "auction extensions must never
 * exceed the Forced Bid Close Time". The window-boundary tests exist because
 * off-by-one errors there are invisible in a demo and decide real auctions.
 */
import {
  decideExtension,
  inTriggerWindow,
  rank,
  rankLabels,
  triggerFired,
  validateCloseTimes,
  type AuctionConfig,
  type Quote,
} from '../src/auction/engine';

/** 2026-01-15, local-free: every time in these tests is an offset from 18:00. */
const at = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 0, 15, h, m, s));

const CLOSE = at(18, 0);
const FORCED = at(18, 30);

const config = (over: Partial<AuctionConfig> = {}): AuctionConfig => ({
  triggerWindowMinutes: 10,
  extensionMinutes: 5,
  trigger: 'L1_CHANGE',
  ...over,
});

const quote = (supplierId: string, totalAmount: number, minute = 0): Quote => ({
  supplierId,
  totalAmount,
  placedAt: at(17, minute),
});

// ------------------------------------------------------------------- ranking

describe('ranking', () => {
  it('orders suppliers cheapest first', () => {
    expect(rank([quote('a', 1200), quote('b', 900), quote('c', 1500)])).toEqual(['b', 'a', 'c']);
  });

  it('breaks ties on who bid first', () => {
    // Equal bids are common in a reverse auction because suppliers undercut to
    // round numbers. Without a deterministic tiebreak, "the ranking changed"
    // would fire at random.
    const first = quote('a', 1000, 10);
    const second = quote('b', 1000, 20);
    expect(rank([second, first])).toEqual(['a', 'b']);
  });

  it('labels positions L1, L2, L3', () => {
    const labels = rankLabels([quote('a', 1200), quote('b', 900)]);
    expect(labels.get('b')).toBe('L1');
    expect(labels.get('a')).toBe('L2');
  });

  it('handles an empty auction without throwing', () => {
    expect(rank([])).toEqual([]);
  });
});

// ------------------------------------------------------------ trigger window

describe('trigger window', () => {
  const X = 10;

  it('opens exactly X minutes before the close', () => {
    expect(inTriggerWindow(at(17, 50), CLOSE, X)).toBe(true);
  });

  it('excludes the instant one millisecond earlier', () => {
    expect(inTriggerWindow(new Date(at(17, 50).getTime() - 1), CLOSE, X)).toBe(false);
  });

  it('excludes the close instant itself', () => {
    // A bid at exactly the close is not a late bid, it is a bid at a closed
    // auction, and it is rejected before it ever reaches this function.
    expect(inTriggerWindow(CLOSE, CLOSE, X)).toBe(false);
  });

  it('includes the last moment before the close', () => {
    expect(inTriggerWindow(new Date(CLOSE.getTime() - 1), CLOSE, X)).toBe(true);
  });

  it('moves with the close after an extension', () => {
    // 17:55 is inside the window against an 18:00 close, and outside it once
    // the auction has already extended to 18:10.
    expect(inTriggerWindow(at(17, 55), CLOSE, X)).toBe(true);
    expect(inTriggerWindow(at(17, 55), at(18, 10), X)).toBe(false);
  });
});

// ---------------------------------------------------------------- the triggers

describe('extension triggers', () => {
  it('BID_RECEIVED fires on any bid, even one that changes nothing', () => {
    const r = triggerFired('BID_RECEIVED', ['a', 'b'], ['a', 'b']);
    expect(r.fired).toBe(true);
  });

  it('ANY_RANK_CHANGE fires when two suppliers swap places', () => {
    const r = triggerFired('ANY_RANK_CHANGE', ['a', 'b', 'c'], ['a', 'c', 'b']);
    expect(r.fired).toBe(true);
    expect(r.reason).toMatch(/L2/);
  });

  it('ANY_RANK_CHANGE ignores a supplier lowering a bid without moving', () => {
    const r = triggerFired('ANY_RANK_CHANGE', ['a', 'b'], ['a', 'b']);
    expect(r.fired).toBe(false);
  });

  it('ANY_RANK_CHANGE ignores a newcomer who lands at the bottom', () => {
    // The array got longer but nobody already ranked moved. A buyer watching
    // the board would not call that a ranking change.
    const r = triggerFired('ANY_RANK_CHANGE', ['a', 'b'], ['a', 'b', 'c']);
    expect(r.fired).toBe(false);
  });

  it('L1_CHANGE fires only when the lowest bidder changes', () => {
    expect(triggerFired('L1_CHANGE', ['a', 'b'], ['b', 'a']).fired).toBe(true);
    expect(triggerFired('L1_CHANGE', ['a', 'b'], ['a', 'c', 'b']).fired).toBe(false);
  });

  it('L1_CHANGE fires on the very first bid of an empty auction', () => {
    const r = triggerFired('L1_CHANGE', [], ['a']);
    expect(r.fired).toBe(true);
    expect(r.reason).toMatch(/first bid/);
  });

  it('L1_CHANGE does not fire when L1 undercuts their own price', () => {
    // The commonest near-close event: the leader defends their position.
    // Under L1_CHANGE that must NOT extend, or the rule collapses into
    // BID_RECEIVED and the leader can stall the auction forever.
    expect(triggerFired('L1_CHANGE', ['a', 'b'], ['a', 'b']).fired).toBe(false);
  });
});

// ------------------------------------------------------------- the decision

describe('decideExtension', () => {
  const base = {
    bidCloseAt: CLOSE,
    forcedCloseAt: FORCED,
    rankingBefore: ['a'],
    rankingAfter: ['b', 'a'],
  };

  it('extends by Y when a trigger fires inside the window', () => {
    const d = decideExtension({ ...base, now: at(17, 55), config: config() });
    expect(d.extend).toBe(true);
    expect(d.newCloseAt).toEqual(at(18, 5));
    expect(d.capped).toBe(false);
  });

  it('does nothing for a bid before the window opens', () => {
    const d = decideExtension({ ...base, now: at(17, 30), config: config() });
    expect(d.extend).toBe(false);
    expect(d.newCloseAt).toEqual(CLOSE);
    expect(d.reason).toMatch(/outside the 10-minute trigger window/);
  });

  it('does nothing when the trigger does not fire', () => {
    const d = decideExtension({
      ...base,
      now: at(17, 55),
      config: config(),
      rankingBefore: ['a', 'b'],
      rankingAfter: ['a', 'b'],
    });
    expect(d.extend).toBe(false);
    expect(d.reason).toMatch(/lowest bidder was unchanged/);
  });

  it('records why it extended, in words', () => {
    const d = decideExtension({ ...base, now: at(17, 55), config: config() });
    expect(d.reason).toMatch(/lowest bidder \(L1\) changed/);
    expect(d.reason).toMatch(/extended by 5 minutes/);
  });
});

// ------------------------------------------------- the one hard invariant

describe('the forced close is a ceiling', () => {
  it('trims the last extension to land exactly on the forced close', () => {
    // Close 18:28, forced 18:30, Y of 5 would reach 18:33. Extending to 18:30
    // rather than refusing keeps two minutes of bidding the buyer configured
    // for, and still honours the ceiling.
    const d = decideExtension({
      now: at(18, 25),
      bidCloseAt: at(18, 28),
      forcedCloseAt: FORCED,
      config: config(),
      rankingBefore: ['a'],
      rankingAfter: ['b', 'a'],
    });
    expect(d.extend).toBe(true);
    expect(d.newCloseAt).toEqual(FORCED);
    expect(d.reason).toMatch(/extended to the forced close time/);
  });

  it('reports capped, not "nothing happened", once sitting on the ceiling', () => {
    // The distinction matters: the bid DID qualify. Losing that signal is what
    // makes a force-closed auction indistinguishable from one that simply ran
    // out of bids.
    const d = decideExtension({
      now: at(18, 25),
      bidCloseAt: FORCED,
      forcedCloseAt: FORCED,
      config: config(),
      rankingBefore: ['a'],
      rankingAfter: ['b', 'a'],
    });
    expect(d.extend).toBe(false);
    expect(d.capped).toBe(true);
    expect(d.newCloseAt).toEqual(FORCED);
    expect(d.reason).toMatch(/cannot extend further/);
  });

  it('no sequence of bids can ever push the close past the forced close', () => {
    // The property, brute-forced. A hundred consecutive snipes, each one
    // landing inside whatever window currently applies.
    let closeAt = CLOSE;
    for (let i = 0; i < 100; i += 1) {
      const justInside = new Date(closeAt.getTime() - 1000);
      const d = decideExtension({
        now: justInside,
        bidCloseAt: closeAt,
        forcedCloseAt: FORCED,
        config: config(),
        rankingBefore: [`s${i}`],
        rankingAfter: [`s${i + 1}`, `s${i}`],
      });
      closeAt = d.newCloseAt;
      expect(closeAt.getTime()).toBeLessThanOrEqual(FORCED.getTime());
    }
    expect(closeAt).toEqual(FORCED);
  });

  it('holds for any X, Y and starting gap', () => {
    for (const extensionMinutes of [1, 5, 17, 60]) {
      for (const gapMinutes of [1, 3, 29, 120]) {
        const forced = new Date(CLOSE.getTime() + gapMinutes * 60_000);
        let closeAt = CLOSE;
        for (let i = 0; i < 50; i += 1) {
          const d = decideExtension({
            now: new Date(closeAt.getTime() - 1000),
            bidCloseAt: closeAt,
            forcedCloseAt: forced,
            config: config({ extensionMinutes }),
            rankingBefore: [`s${i}`],
            rankingAfter: [`s${i + 1}`, `s${i}`],
          });
          closeAt = d.newCloseAt;
          expect(closeAt.getTime()).toBeLessThanOrEqual(forced.getTime());
        }
      }
    }
  });
});

// ------------------------------------------------------------------ validation

describe('close-time validation', () => {
  it('rejects a forced close that is not after the bid close', () => {
    const errors = validateCloseTimes({
      bidStartAt: at(17, 0),
      bidCloseAt: CLOSE,
      forcedCloseAt: CLOSE,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be later than/);
  });

  it('rejects a close before the start', () => {
    const errors = validateCloseTimes({
      bidStartAt: at(19, 0),
      bidCloseAt: CLOSE,
      forcedCloseAt: FORCED,
    });
    expect(errors[0]).toMatch(/after the bid start/);
  });

  it('accepts a well-ordered set of times', () => {
    expect(
      validateCloseTimes({ bidStartAt: at(17, 0), bidCloseAt: CLOSE, forcedCloseAt: FORCED }),
    ).toEqual([]);
  });
});
