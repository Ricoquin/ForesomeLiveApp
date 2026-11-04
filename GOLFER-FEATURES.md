# ForeSome golfer features — setup

New in this update: course rankings, real AI insight, private groups with admin controls,
live chat (group + friend messages), game setup (Best Ball, Scramble, Skins, Nassau,
Stableford, Match play), and Apple Watch / Wear OS GPS apps.

## 1. Update the database (once, ~1 minute)
Supabase Dashboard → SQL Editor → New query → paste `supabase/2026-11-golfer-features.sql` → Run.
Safe to run again. Until this runs, the new screens show a message saying so.

## 2. Turn on AI insight (optional — the Intel card falls back to a plain stat summary)
```
npm install -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy player-insight
```
The AI runs once per new round per player (answers are cached), using a low-cost model.

## 3. Ship the web app
Commit and push. Vercel builds as before (`npm run build`).

## 4. Watch apps (optional)
Both are standalone (no phone app needed) and work offline with the courses in
`watch/shared/courses.json`.

- **Apple Watch:** needs a Mac with Xcode 15+ and an Apple Developer account to install on a real watch.
  `brew install xcodegen && cd watch/apple && xcodegen && open ForeSomeWatch.xcodeproj`
  Set your Team in Signing, change the bundle ID in `project.yml`, then run on the Watch simulator or your watch.
- **Wear OS:** open `watch/wearos` in Android Studio (it sets up Gradle), then run on a Wear OS emulator or watch.
  Change `applicationId` in `app/build.gradle.kts` before publishing.

## Where things live
| Feature | Code |
|---|---|
| Games + scoring engine | `src/features/games/` (tests: `node scratch/test-scoring.mjs`) |
| Rankings | `src/features/rankings/Rankings.jsx` + SQL functions `course_leaderboard`, `my_course_ranks` |
| AI insight | `src/features/insight/InsightCard.jsx` + `supabase/functions/player-insight/` |
| Friend messages | `src/features/chat/DirectMessages.jsx` |
| Group admin + discovery | `src/features/groups/GroupAdmin.jsx` |
| Watch apps | `watch/apple`, `watch/wearos`, shared data `watch/shared/courses.json` |

A copy of the previous `App.jsx` and `global.css` is in `scratch/backup-2026-11-04/`.
