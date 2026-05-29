# ForesomeLiveApp

This repository is configured for GitHub Pages deployment to a custom domain.

## GitHub Pages settings

- Branch: `main`
- Folder: the workflow publishes the generated `dist/`
- Custom domain: `foresomekc.com`

## Files that configure deployment

- `.github/workflows/pages.yml` — builds the app and deploys `dist/`
- `CNAME` — specifies the custom domain `foresomekc.com`

## DNS requirements

Add the following A records for `foresomekc.com`:

- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

If you need help verifying your GitHub Pages settings in the repo, I can guide you through the exact UI steps.

## Supabase setup

1. Create a new Supabase project at https://app.supabase.com.
2. Copy the project URL and anonymous key into a local `.env` file from `.env.example`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Create the `rounds` table in Supabase using the SQL in `supabase/schema.sql`.
4. In Supabase, make sure the `rounds` table is allowed to be read and inserted from the client (configure Row Level Security or use a service role key if needed).
5. Run your app locally with `npm run dev` and confirm rounds load/save correctly.

## Supabase auth

This app uses Supabase authentication so each round is stored for the signed-in user.

- Use email/password sign in from the app.
- The `user_id` column in `rounds` is set to `auth.uid()`.
- Only the authenticated user can read and insert their own rounds.

## Supabase schema

The app expects a `rounds` table with these columns:
- `id` (text, primary key)
- `course_id` (text)
- `course_name` (text)
- `tee` (text)
- `created_at` (timestamptz)
- `hole_scores` (jsonb)
- `summary` (jsonb)
- `completed_holes` (integer)

Optionally, use `supabase/schema.sql` to create the table directly in the SQL editor.

## Row Level Security

To make the project more secure, enable RLS on the `rounds` table and apply policies using `supabase/policies.sql`.

1. In the Supabase dashboard, go to the SQL editor.
2. Run the SQL in `supabase/policies.sql`.
3. If you later add auth, update the table with a `user_id` column and replace the open anon policies with user-based policies.
