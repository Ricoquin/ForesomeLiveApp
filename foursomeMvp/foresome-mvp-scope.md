# ForeSome — MVP Scope (Friday Launch)

**The anchor. If a feature isn't on the "In" list, it's not in Friday's build. Full stop.**

---

## What ForeSome is at launch

A **golf scorecard that remembers.** A player logs a round hole by hole, and the app turns those rounds into personal stats and course history over time. Works for a single user, alone, with nobody else on the app — which is exactly what you need with a launch crowd of four (you, TJ, Keith, E).

It is **not** a matching app yet. It is **not** a social app yet. Those are earned in later phases, built on the data the scorecard collects.

---

## IN — ships Friday

### 1. Hole-by-hole scorecard (the core)
- Pick a **course**
- Pick a **tee type**
- Per hole, log: **score**, **GIR** (green in regulation), **FIR** (fairway in regulation), **putts**
- Running totals as the round progresses
- Save the completed round

### 2. Profile
- Basic player identity — name, handle
- Owns the user's rounds and stats
- Keep it minimal; this is a container, not a feature

### 3. Stats history (per user)
- Falls out of the scorecard for free
- Trends across rounds: scoring average, GIR %, FIR %, putts/round
- Value to a party of one — no other golfers required

### 4. Course history
- Same logged data, organized by course
- Rounds played at each course, best/average score there

> These four are really **one connected thing**: a scorecard that records, then reflects your game back to you. Complete and satisfying on day one for a single user.

---

## OUT — explicitly NOT Friday (this is the discipline)

| Feature | Why it waits | Phase |
|---|---|---|
| Post a tee time | Matching marketplace — empty/cold with 4 users | 2 |
| Join a tee time | Same; needs density to feel alive | 2 |
| Group chat | Real-time infra is expensive; pointless until matching exists | 2 |
| Player course rankings | Leaderboards need volume of rounds to mean anything | 3 |

**The test every feature had to pass:** *Can it deliver value to one user, alone, with nobody else on the app?* The four "In" features pass. The four "Out" features need a crowd or heavy infra that doesn't pay off on day one.

---

## The sequencing logic (why this order is right)

Scorecard collects the data → stats + history make it useful solo → that gives people a reason to keep logging → logged rounds create the density that finally makes matching and rankings worth switching on.

You're not deferring the social vision. You're **earning** it — each later phase lands on a foundation that's already collecting data instead of starting cold.

---

## Launch-week rule

Scope is **frozen.** New ideas this week go to the roadmap/parking lot, not the build. The job between now and Friday is to make these four features solid — not to add a fifth.
