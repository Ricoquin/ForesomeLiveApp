-- Supabase schema for ForesomeLiveApp rounds

create table if not exists rounds (
  id text primary key,
  course_id text,
  course_name text,
  tee text,
  created_at timestamptz default now(),
  hole_scores jsonb not null,
  summary jsonb not null,
  completed_holes integer not null
);

create index if not exists rounds_created_at_idx on rounds (created_at desc);
create index if not exists rounds_course_id_idx on rounds (course_id);
