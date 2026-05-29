-- Supabase schema for ForeSome V1 App

-- Drop existing tables to ensure a clean slate
drop table if exists alerts;
drop table if exists snaps;
drop table if exists rounds;
drop table if exists profiles;

-- Profiles table (linked to auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text not null,
  handicap integer default 0,
  initials text,
  created_at timestamptz default now()
);

-- Rounds table (linked to auth.users)
create table rounds (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  course_id text,
  course_name text,
  tee text,
  created_at timestamptz default now(),
  hole_scores jsonb not null,
  summary jsonb not null,
  completed_holes integer not null
);

create index rounds_created_at_idx on rounds (created_at desc);
create index rounds_course_id_idx on rounds (course_id);
create index rounds_user_id_idx on rounds (user_id);

-- Snaps table (Community Snaps)
create table snaps (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  author_name text not null,
  content text not null,
  image_url text, -- Optional Supabase Storage image URL
  image_bg_color text default '#2e4936',
  image_text text,
  created_at timestamptz default now()
);

create index snaps_created_at_idx on snaps (created_at desc);

-- Alerts table (User Notifications & Invites)
create table alerts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  type text not null, -- 'invitation', 'activity', 'system'
  title text not null,
  body text not null,
  status text default 'pending', -- 'pending', 'accepted', 'declined', 'read'
  created_at timestamptz default now()
);

create index alerts_user_id_idx on alerts (user_id);
