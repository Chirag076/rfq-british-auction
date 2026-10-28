# RFQ with British-auction bidding

A simplified RFQ system where suppliers compete by bidding **down**, and
activity near the close pushes the close out — up to a forced ceiling that
never moves.

**Live: https://rfq.evrrun.com**

It runs on a free tier, so the first request after a quiet spell takes about a
minute to wake the API — the page says so rather than spinning silently. The
demo auction closes five minutes after the data is seeded, so press **Reset
demo data** on the listing page for one that is about to close.

Or run the whole thing locally:

```bash
docker compose up --build
```

Then open **http://localhost:5173**. The seed creates an auction closing in
**five minutes** with its trigger window already open, so you can place a bid
and watch the clock jump.

---

## What a British auction is here

- Suppliers submit quotes openly and may lower them to beat each other.
- If qualifying activity happens in the last **X** minutes, the close moves out
  by **Y** minutes.
- A **forced close** is a hard ceiling. Extensions clamp to it and never pass it.

Three configurable triggers decide what "qualifying activity" means:

| Trigger | Extends when |
|---|---|
| `BID_RECEIVED` | any bid lands inside the window |
| `ANY_RANK_CHANGE` | the order of suppliers changes |
| `L1_CHANGE` | the lowest bidder changes |

## The part worth reviewing first

Everything else is CRUD. These two are where the system is actually hard.

**`backend/src/auction/engine.ts`** — the rules as pure functions. No database,
no clock, no framework. The whole auction specification reads in one file, and
it is tested exhaustively, including a brute-force proof that no sequence of
bids can push the close past the forced close for any X, Y or starting gap.

**`backend/src/bids/bids.service.ts`** — one transaction that opens with
`SELECT … FOR UPDATE` on the RFQ row. Submitting a bid is a read-modify-write
on shared state, and the moment it matters most is the final seconds, which is
exactly when two suppliers are most likely to do it at once. Without the lock,
both read the same "before" ranking, both decide to extend, and the auction
either jumps 2Y into the future or loses an extension — silently, either way.

A row lock rather than `SERIALIZABLE` because serializable makes the losing
transaction *fail and retry*; a lock makes it *wait*. At 17:59:59 a supplier
can survive waiting 5ms. They cannot survive a rejection.

## Design decisions, and what they cost

**Three close times, not one.** `originalCloseAt` never moves, `bidCloseAt`
moves on extension, `forcedCloseAt` is the ceiling. Keeping the original is
what lets the UI say "extended 12 minutes so far" without replaying the event
log on every page load.

**A `superseded` flag instead of "latest bid per supplier".** Ranking runs on
every bid, in the hot path, under a lock. A flag makes it one indexed scan;
"latest per supplier" is a window function that no index covers well and that
gets slower exactly as an auction gets busy. Cost: one more column to keep
honest, done inside the same transaction.

**`totalAmount` stored, not computed.** Denormalised on purpose — a stored
column can carry the index that ranking orders by, an expression cannot. It is
written in the same statement as its three parts so it cannot drift.

**Reasons stored as sentences, not codes.** The brief asks for "reason for each
extension", and the useful answer depends on the ranking at that instant:
*"supplier ranking changed at position L2 inside the trigger window; extended
by 3 minutes"*. Reconstructing that later from a code plus timestamps is
guesswork. Cost: not translatable without rework.

**A closing sweep, not a derived status.** Status could be computed from the
clock with no job at all. But then nothing ever *happens*, so there is no close
event for the activity log, and `CLOSED` cannot be told apart from
`FORCE_CLOSED` — which depends on whether a trigger was still firing at the
end. So the clock stays authoritative for *accepting bids* (checked directly,
because the sweep runs on an interval and a late bid must never slip through),
and the sweep is authoritative for the recorded outcome.

**A supplier may only improve on their own quote.** Without it, a supplier can
bid *upward* in the last seconds to trigger an extension under `BID_RECEIVED`
while conceding nothing — the exact manipulation the trigger window exists to
prevent.

**Extensions clamp rather than refuse.** If the close is 18:28, the ceiling is
18:30 and Y is 5 minutes, the auction extends to 18:30 — not "no extension".
Refusing would throw away two minutes of bidding the buyer configured for.

## Known limitations

- **No authentication.** Supplier is a dropdown. Auth adds nothing to the
  auction mechanics, and switching supplier in one click is what makes a rank
  change demonstrable by one person on one screen.
- **One API instance assumed.** The row lock is correct across instances, but
  the closing sweep would double-fire. It needs `pg_advisory_lock` or a leader
  election before running more than one.
- **Socket.IO is single-node.** Rooms would need the Redis adapter to work
  across instances.
- **Server clock is the clock.** No NTP assumptions are documented, and a
  skewed clock moves real money in a real auction.
- **The activity log is capped at 100 events** on the detail page, with no
  pagination.
- **`POST /api/demo/reset` wipes the database and is unauthenticated.** It
  exists so the hosted demo always has an auction about to close, since the
  seed otherwise runs once at deploy time. In a real system it would sit behind
  an admin role, or not ship.
- **No proxy bidding, reserve prices or partial lots.**

## What I would do next

1. **Replace the closing sweep with a delayed queue** keyed by close time, so
   there is no polling and no leader election to get wrong.
2. **Auth and supplier isolation** — suppliers should see their own rank and
   the lowest bid, not every competitor's full quote.
3. **Make the engine's property test a generative one** (fast-check) rather
   than a hand-rolled loop over a few hundred cases.
4. **Bid-level audit for disputes** — who saw what close time when, which is
   the first thing asked after a contested auction.

---

## Deploying it

`render.yaml` is a Render blueprint: Postgres, the API from
`backend/Dockerfile`, and the React build as a static site.

1. Push the repo, then **New Blueprint Instance** at
   [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)
   and point it at the repo. All three resources are created from the file.
2. When the API finishes deploying, copy its public URL. **Check it**: service
   names are global, so a taken one gets a random suffix — this deployment
   asked for `rfq-api` and was given `rfq-api-z4zb`.
3. On the **rfq-web** service, set `VITE_API_BASE` to that URL and redeploy
   with **Clear build cache & deploy**.

Step 3 cannot be skipped. Vite inlines `VITE_*` values into the bundle at build
time, and Render does not expose one service's public URL to another service's
environment, so the first build necessarily compiles in a guess.

The free tier shapes the demo in three ways worth knowing before you judge it:

- The API **sleeps after 15 minutes idle** and takes about a minute to wake.
  The UI says so rather than spinning silently.
- While it is asleep the closing sweep is not running, so an auction past its
  close stays `ACTIVE` until the next request wakes the service — then closes
  within ten seconds.
- The seeded auction closes five minutes after the data is written, which on a
  deployment means five minutes after the deploy. **Reset demo data** on the
  listing page puts a fresh one in front of you.

## Running it

**Docker (recommended):**

```bash
docker compose up --build       # web :5173, api :4000, postgres :5432
```

The api container runs `backend/docker-entrypoint.sh`, which pushes the schema
and then starts the app; the app seeds itself only if the database is empty.
That is the same start-up the deployed instance runs, so it is not a path that
only production exercises.

**Without Docker:**

```bash
# database
createdb rfq

# api
cd backend
cp .env.example .env            # point DATABASE_URL at your Postgres
npm install
npx prisma generate
npx prisma db push
npx ts-node prisma/seed.ts
npm run start:dev               # :4000

# web
cd ../frontend
npm install
npm run dev                     # :5173
```

**Tests:**

```bash
cd backend && npm test
```

## Seeing an extension happen

1. `docker compose up --build`, open http://localhost:5173
2. Open **RFQ-2026-101** — it closes in five minutes, trigger is `L1_CHANGE`,
   X = 5 minutes, Y = 3 minutes. The window is already open.
3. Submit a quote **below** the current lowest, as a different supplier.
4. The countdown jumps three minutes and a new entry appears in the activity
   log saying why.
5. Keep going. The close walks towards the forced close and stops dead on it —
   the last extension is trimmed to land exactly there, and after that the log
   records `Capped` instead.

## Layout

```
backend/
  src/auction/engine.ts        the rules, pure, no IO        ← read this first
  src/auction/closer.service.ts  finalises auctions, cron
  src/bids/bids.service.ts     the locked transaction        ← and this
  src/rfq/rfq.service.ts       create, list, detail
  src/events/events.gateway.ts Socket.IO rooms per RFQ
  src/demo/demo.seed.ts        the demo dataset, shared by all three callers
  src/health/                  health check with a real query
  prisma/schema.prisma         four tables
  prisma/seed.ts               CLI seed; the data lives in src/demo
  test/engine.spec.ts          27 tests
frontend/
  src/pages/AuctionList.jsx    listing: lowest bid, status, countdown
  src/pages/AuctionDetail.jsx  ranking, config, activity log
  src/pages/CreateRfq.jsx      RFQ creation with the validation rules
  src/components/              countdown, bid form, socket hook, loading state
docs/
  architecture.md              HLD + diagram
  schema.md                    tables, indexes, and why
docker-compose.yml             local: three containers
render.yaml                    deploy: database, API, static site
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/rfqs` | listing: status, lowest bid, close times, config |
| `POST /api/rfqs` | create an RFQ (validates forced close > bid close) |
| `GET /api/rfqs/:id` | ranking, quote details, config, activity log |
| `POST /api/rfqs/:id/bids` | submit a quote; may extend the auction |
| `GET /api/suppliers` | the supplier list for the bid form |
| `POST /api/demo/reset` | wipe and re-seed the demo data (see limitations) |
| `GET /health` | liveness + a real `SELECT 1`, used by the platform health check |

WebSocket: `watch`/`unwatch` an RFQ id; receives `auction:changed` for that
auction and `auctions:changed` for the list.

## AI tools

Built with AI assistance, which the recruiter confirmed by email was permitted
for this assignment.
