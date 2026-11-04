# ForeSome Community Layer — Phase 1 (Events & Scoring)

Phase 1 of the community plan: events, sign-up and waitlist, pairings, check-in,
live leaderboards with TV mode, and season points. Fees are recorded as
"pay at course" until Stripe arrives in Phase 2.

## Setup (once)

1. Run `supabase/2026-11-golfer-features.sql` first if you haven't yet.
2. In the Supabase SQL editor, run `supabase/2026-11-community-phase1.sql`.
   It is safe to run again. It also loads the 86 KC courses into a new `courses` table.
3. Make yourself the first ForeSome admin (find your id in Authentication → Users):
   ```sql
   insert into platform_admins (profile_id) values ('<your user id>');
   ```
4. `npm install` (adds the `qrcode` package), then deploy to Vercel as usual.
5. In the app, open **Workspaces → ForeSome admin**, create "Orion", link its
   courses, and add the Orion manager as owner. They add their pro shop staff
   from **Clubhouse → Staff**.

## Who sees what

One login per person. What each person sees comes from their role rows.

| Role | Where | Can do |
|---|---|---|
| Golfer | Home → Events | Browse events, sign up (questions, discount codes), join waitlists, show check-in QR, check in on event day, enter scores, see leaderboards, join communities |
| Community member | Community page | Member-only events, member pricing, season standings |
| Community admin / co-admin | Workspaces → Organizer | Create events, manage players, mark paid, pairings, cart signs, codes, finalize results, approve members, seasons and points. Only owners add admins; co-admins can't add admins |
| Course staff | Workspaces → Clubhouse | Check-in kiosk (QR scan or search), mark paid, events at their courses, Events & Groups dashboard |
| Operator owner / admin | Workspaces → Clubhouse | Everything staff can do, plus Staff and Courses |
| ForeSome admin | Workspaces → ForeSome admin | Create operators, link courses, assign owners, add ForeSome admins |

Workspaces only shows the sections a person has a role for.

## Links anyone can open

- `/e/<event id>`: public event page with live leaderboard and sign-up. No install.
- `/tv/<event id>`: full-screen leaderboard for the pro shop TV. Cycles flights every 12 seconds.

## Notes

- Payments are not taken in the app yet. Staff tap **Paid** at check-in.
- Waitlist promotion writes to `notification_outbox`; the app shows it in Events.
  Push and email delivery needs the Phase 2 `notify` Edge Function.
- QR scanning at the kiosk uses the browser's barcode reader (Chrome, Android).
  On iPhone Safari, staff use the name search instead.
- TeeQuest has no API, so the event stores the confirmation number only.
- Finalized events are saved to each player's round history and award season points.
