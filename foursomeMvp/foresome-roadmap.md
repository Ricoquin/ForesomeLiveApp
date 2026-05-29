# ForeSome — Roadmap / Parking Lot

**Purpose:** capture every post-launch idea so it's safe to set down — not cluttering the Friday build, not lost. Nothing here is on the launch critical path.

---

## Phase 2 — Make it social (after scorecard is solid + people are logging rounds)

### Post / Join tee times (the matching marketplace)
- A player posts a tee time looking for others; others join.
- This is ForeSome's original vision — the foursome-finder.
- **Gated on:** enough active users that the feed isn't empty. Watch round-logging volume as the signal that density is building.
- Comes with the **Groups foundation already built** (data model + admin panel + feed — see project files): public pool + private group-scoped tee times, RLS-enforced.

### Group chat / messaging
- Coordinate a matched foursome.
- Build **after** matching exists — chat is pointless until people have something to coordinate.
- Real-time messaging is deceptively expensive to build well; budget for it.

### Groups (private rooms)
- Walled-off spaces inside the app: **The Women's Locker Room** (KC women's club — real inbound demand), country clubs, competitive vs. casual crews, corporate leagues.
- Generic "Groups/Clubs" primitive; each group is a row, not new code.
- Role hierarchy: super_admin (Rico) → group_admin (club contact) → member.
- Club owns its own membership gate; ForeSome provides the container.
- **Foundation already built** — ships as soon as matching is live.

---

## Phase 3 — Make it competitive (after volume of rounds exists)

### Player course rankings
- Leaderboards per course, off logged rounds.
- **Builds itself quietly** while everyone logs rounds in Phase 1+ — ready to switch on once there's volume.
- A ranking of 4 people is a joke; a ranking off hundreds of rounds is a reason to come back. Needs density first.

---

## Parking lot — unsequenced ideas (capture, don't commit)

- **Hole-by-hole course mockup / visual scorecard** — richer scoring UI; mock up post-launch as a concept.
- Country-club tier (premium/paid group features for clubs).
- Competitive vs. non-competitive group types.
- Course partner integrations (Shoal Creek, Swope, Heart of America posting open times).
- Stats deep-dives — strokes gained, trends over season.

---

## Rules for this list

1. New idea during launch week → it goes **here**, not in the build.
2. Don't promote anything to "building" until the phase before it is solid and the gating condition is met.
3. Capturing an idea ≠ committing to it. The parking lot is allowed to hold things forever.
