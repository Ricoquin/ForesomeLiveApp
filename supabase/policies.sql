-- Supabase Row Level Security policy for ForesomeLiveApp rounds

-- Enable RLS on the rounds table
alter table rounds enable row level security;

-- Allow anyone to select rounds (public access)
create policy "Allow public read access" on rounds
  for select
  using (true);

-- Allow anyone to insert rounds (public access)
create policy "Allow public insert access" on rounds
  for insert
  with check (true);

-- Optional: allow anyone to update or delete their own rounds (using ID matching if desired)
create policy "Allow public update access" on rounds
  for update
  using (true)
  with check (true);

create policy "Allow public delete access" on rounds
  for delete
  using (true);

