-- Supabase Row Level Security policy for ForesomeLiveApp rounds

-- Enable RLS on the rounds table
alter table rounds enable row level security;

-- Allow anonymous clients to read rounds when using the public anon key
create policy "Allow anon select" on rounds
  for select
  using (auth.role() = 'anon');

-- Allow anonymous clients to insert rounds when using the public anon key
create policy "Allow anon insert" on rounds
  for insert
  with check (auth.role() = 'anon');

-- If you later add authentication, use a user_id column and secure policies:
-- alter table rounds add column user_id text;
-- create policy "Users can select their own rounds" on rounds
--   for select
--   using (auth.uid() = user_id);
-- create policy "Users can insert their own rounds" on rounds
--   for insert
--   with check (auth.uid() = user_id);
