-- Supabase Row Level Security policies for ForeSome V1 App

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table rounds enable row level security;
alter table snaps enable row level security;
alter table alerts enable row level security;

-- ==========================================
-- PROFILES POLICIES
-- ==========================================

-- Anyone can view profiles (to show names, initials, etc.)
create policy "Allow public read access to profiles" on profiles
  for select
  using (true);

-- Users can insert their own profile during registration
create policy "Allow users to insert their own profile" on profiles
  for insert
  with check (auth.uid() = id);

-- Users can update their own profile (e.g. change username/handicap)
create policy "Allow users to update their own profile" on profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ==========================================
-- ROUNDS POLICIES
-- ==========================================

-- Users can read their own rounds only
create policy "Allow users to select their own rounds" on rounds
  for select
  using (auth.uid() = user_id);

-- Users can insert their own rounds
create policy "Allow users to insert their own rounds" on rounds
  for insert
  with check (auth.uid() = user_id);

-- Users can update their own rounds
create policy "Allow users to update their own rounds" on rounds
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can delete their own rounds
create policy "Allow users to delete their own rounds" on rounds
  for delete
  using (auth.uid() = user_id);

-- ==========================================
-- SNAPS POLICIES
-- ==========================================

-- Anyone can read snaps (community feed is public)
create policy "Allow public read access to snaps" on snaps
  for select
  using (true);

-- Authenticated users can insert their own snaps
create policy "Allow authenticated users to insert their own snaps" on snaps
  for insert
  with check (auth.uid() = user_id);

-- Users can update or delete their own snaps
create policy "Allow users to update their own snaps" on snaps
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Allow users to delete their own snaps" on snaps
  for delete
  using (auth.uid() = user_id);

-- ==========================================
-- ALERTS POLICIES
-- ==========================================

-- Users can only read their own alerts
create policy "Allow users to select their own alerts" on alerts
  for select
  using (auth.uid() = user_id);

-- Users can insert alerts for themselves
create policy "Allow users to insert their own alerts" on alerts
  for insert
  with check (auth.uid() = user_id);

-- Users can update their own alerts (e.g. Accept/Decline status)
create policy "Allow users to update their own alerts" on alerts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can delete their own alerts
create policy "Allow users to delete their own alerts" on alerts
  for delete
  using (auth.uid() = user_id);
