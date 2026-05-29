-- Supabase Row Level Security policy for ForesomeLiveApp rounds

-- Enable RLS on the rounds table
alter table rounds enable row level security;

-- Allow authenticated users to read their own rounds only
create policy "Users can select their own rounds" on rounds
  for select
  using (auth.uid() = user_id);

-- Allow authenticated users to insert rounds for themselves only
create policy "Users can insert their own rounds" on rounds
  for insert
  with check (auth.uid() = user_id);

-- Optional: allow authenticated users to update or delete their own rounds
-- create policy "Users can update their own rounds" on rounds
--   for update
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
--
-- create policy "Users can delete their own rounds" on rounds
--   for delete
--   using (auth.uid() = user_id);
