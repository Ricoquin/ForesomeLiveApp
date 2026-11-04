-- ForeSome golfer features (Nov 2026)
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run more than once.
--   1. Rankings (course leaderboards + "my ranks")
--   2. Groups: privacy levels, co-admins, join requests, moderation
--   3. Direct messages between friends
--   4. Games (Best Ball, Scramble, Skins, Nassau, Stableford, Match play)
--   5. AI insight cache
--   6. Live updates (Realtime) for chat and games

-- ───────────────────────── 1. RANKINGS ─────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_in_rankings boolean DEFAULT true;

CREATE OR REPLACE FUNCTION _round_num(j jsonb, k text) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(j -> k) = 'number' THEN (j ->> k)::numeric END
$$;

-- Leaderboard for one course. p_metric: 'score' (low round), 'putts' (fewest),
-- 'gir' (most greens in regulation), 'fir' (most fairways hit). Full 18-hole rounds only.
CREATE OR REPLACE FUNCTION course_leaderboard(p_course text, p_metric text DEFAULT 'score', p_limit int DEFAULT 25)
RETURNS TABLE(user_id uuid, username text, initials text, handicap int,
              best_value int, avg_score numeric, rounds_played int, rank bigint)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH r AS (
    SELECT r.user_id,
           _round_num(r.summary, 'score') AS score,
           CASE p_metric WHEN 'putts' THEN  _round_num(r.summary, 'putts')
                         WHEN 'gir'   THEN -_round_num(r.summary, 'gir')
                         WHEN 'fir'   THEN -_round_num(r.summary, 'fir')
                         ELSE              _round_num(r.summary, 'score') END AS k
    FROM rounds r JOIN profiles p ON p.id = r.user_id
    WHERE auth.uid() IS NOT NULL
      AND r.course_name = p_course AND r.completed_holes = 18
      AND (COALESCE(p.show_in_rankings, true) OR r.user_id = auth.uid())
  ), agg AS (
    SELECT user_id, min(k) AS best_k, round(avg(score), 1) AS avg_score, count(*) AS n
    FROM r WHERE k IS NOT NULL GROUP BY user_id
  )
  SELECT a.user_id, p.username, p.initials, p.handicap, abs(a.best_k)::int, a.avg_score, a.n::int,
         rank() OVER (ORDER BY a.best_k, a.avg_score)
  FROM agg a JOIN profiles p ON p.id = a.user_id
  ORDER BY 8, p.username
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

-- Where I rank (by best round) at every course I've played.
CREATE OR REPLACE FUNCTION my_course_ranks()
RETURNS TABLE(course_name text, best_score int, rounds_played int, rank bigint, field_size bigint)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH mine AS (
    SELECT DISTINCT course_name FROM rounds WHERE user_id = auth.uid() AND completed_holes = 18
  ), r AS (
    SELECT r.user_id, r.course_name, _round_num(r.summary, 'score') AS score
    FROM rounds r JOIN profiles p ON p.id = r.user_id
    WHERE r.course_name IN (SELECT course_name FROM mine) AND r.completed_holes = 18
      AND (COALESCE(p.show_in_rankings, true) OR r.user_id = auth.uid())
  ), agg AS (
    SELECT course_name, user_id, min(score) AS best, avg(score) AS av, count(*) AS n
    FROM r WHERE score IS NOT NULL GROUP BY 1, 2
  ), ranked AS (
    SELECT *, rank() OVER (PARTITION BY course_name ORDER BY best, av) AS rk,
              count(*) OVER (PARTITION BY course_name) AS fs
    FROM agg
  )
  SELECT course_name, best::int, n::int, rk, fs FROM ranked
  WHERE user_id = auth.uid() ORDER BY rk, course_name;
$$;

REVOKE ALL ON FUNCTION course_leaderboard(text, text, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION my_course_ranks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION course_leaderboard(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION my_course_ranks() TO authenticated;

-- ───────────────────────── 2. GROUPS ─────────────────────────
ALTER TABLE groups ADD COLUMN IF NOT EXISTS privacy text DEFAULT 'secret';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS members_can_invite boolean DEFAULT false;
-- secret = invisible, invite only · closed = visible, ask to join · public = anyone can join
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_privacy_check;
ALTER TABLE groups ADD CONSTRAINT groups_privacy_check CHECK (privacy IN ('secret', 'closed', 'public'));

ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_role_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_role_check CHECK (role IN ('admin', 'co_admin', 'member'));
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_status_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_status_check CHECK (status IN ('active', 'invited', 'requested', 'removed'));

-- Owner or an active co-admin.
CREATE OR REPLACE FUNCTION is_group_admin(gid uuid, uid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM groups WHERE id = gid AND admin_id = uid)
      OR EXISTS (SELECT 1 FROM group_members WHERE group_id = gid AND user_id = uid
                 AND role IN ('admin', 'co_admin') AND status = 'active');
$$;

CREATE OR REPLACE FUNCTION is_group_owner(gid uuid, uid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM groups WHERE id = gid AND admin_id = uid);
$$;

-- Server-side rules for who may add or change a membership row.
CREATE OR REPLACE FUNCTION guard_group_members() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g groups%ROWTYPE; me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN NEW; END IF;               -- service role / SQL editor
  SELECT * INTO g FROM groups WHERE id = NEW.group_id;

  IF TG_OP = 'INSERT' THEN
    IF is_group_admin(NEW.group_id, me) THEN
      IF NEW.role <> 'member' AND NOT is_group_owner(NEW.group_id, me) THEN
        RAISE EXCEPTION 'Only the group owner can add admins';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.role <> 'member' THEN RAISE EXCEPTION 'Not allowed'; END IF;
    IF NEW.user_id = me AND NEW.status = 'requested' AND g.privacy IN ('closed', 'public') THEN RETURN NEW; END IF;
    IF NEW.user_id = me AND NEW.status = 'active' AND g.privacy = 'public' THEN RETURN NEW; END IF;
    IF NEW.status = 'invited' AND g.members_can_invite AND EXISTS (
         SELECT 1 FROM group_members WHERE group_id = NEW.group_id AND user_id = me AND status = 'active') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'You can''t add members to this group';
  END IF;

  -- UPDATE
  IF NEW.role <> OLD.role AND NOT is_group_owner(NEW.group_id, me) THEN
    RAISE EXCEPTION 'Only the group owner can change roles';
  END IF;
  IF OLD.user_id = g.admin_id AND NEW.status <> OLD.status AND me <> g.admin_id THEN
    RAISE EXCEPTION 'The group owner can''t be removed';
  END IF;
  IF is_group_admin(NEW.group_id, me) THEN RETURN NEW; END IF;
  IF NEW.user_id = me AND NEW.role = OLD.role
     AND (NEW.status = OLD.status OR (OLD.status = 'invited' AND NEW.status IN ('active', 'removed'))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Not allowed';
END $$;

DROP TRIGGER IF EXISTS group_members_guard ON group_members;
CREATE TRIGGER group_members_guard BEFORE INSERT OR UPDATE ON group_members
  FOR EACH ROW EXECUTE FUNCTION guard_group_members();

-- Groups: members see their groups; everyone signed in can find closed/public ones.
DROP POLICY IF EXISTS "Discoverable groups are visible" ON groups;
CREATE POLICY "Discoverable groups are visible" ON groups
  FOR SELECT USING (auth.role() = 'authenticated' AND privacy IN ('closed', 'public'));

DROP POLICY IF EXISTS "Admin can update their groups" ON groups;
DROP POLICY IF EXISTS "Admins can update their groups" ON groups;
CREATE POLICY "Admins can update their groups" ON groups
  FOR UPDATE USING (is_group_admin(id, auth.uid()));

-- Memberships: the trigger above decides; policies just require a signed-in user.
DROP POLICY IF EXISTS "Admin can add members" ON group_members;
DROP POLICY IF EXISTS "Members and admins can add rows" ON group_members;
CREATE POLICY "Members and admins can add rows" ON group_members
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can view group members" ON group_members;
DROP POLICY IF EXISTS "Members can view group members" ON group_members;
CREATE POLICY "Users can view group members" ON group_members
  FOR SELECT USING (
    group_members.group_id IN (SELECT get_my_group_ids(auth.uid()))
    OR group_members.user_id = auth.uid()
    OR is_group_admin(group_members.group_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own membership or admin can update" ON group_members;
DROP POLICY IF EXISTS "Admin can update members" ON group_members;
CREATE POLICY "Users can update own membership or admin can update" ON group_members
  FOR UPDATE USING (auth.uid() = user_id OR is_group_admin(group_id, auth.uid()));

DROP POLICY IF EXISTS "Users can leave or admin can remove" ON group_members;
DROP POLICY IF EXISTS "Admin can remove members" ON group_members;
CREATE POLICY "Users can leave or admin can remove" ON group_members
  FOR DELETE USING (auth.uid() = user_id OR is_group_admin(group_id, auth.uid()));

DROP POLICY IF EXISTS "Admins can delete messages" ON group_messages;
CREATE POLICY "Admins can delete messages" ON group_messages
  FOR DELETE USING (auth.uid() = user_id OR is_group_admin(group_id, auth.uid()));

-- ───────────────────────── 3. DIRECT MESSAGES ─────────────────────────
CREATE OR REPLACE FUNCTION are_friends(a uuid, b uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM friends WHERE status = 'accepted'
    AND ((user_id = a AND friend_id = b) OR (user_id = b AND friend_id = a)));
$$;

CREATE TABLE IF NOT EXISTS direct_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at timestamptz DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS dm_pair_idx ON direct_messages (sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dm_recipient_idx ON direct_messages (recipient_id, created_at DESC);
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "See my conversations" ON direct_messages;
CREATE POLICY "See my conversations" ON direct_messages
  FOR SELECT USING (auth.uid() IN (sender_id, recipient_id));
DROP POLICY IF EXISTS "Message my friends" ON direct_messages;
CREATE POLICY "Message my friends" ON direct_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id AND are_friends(sender_id, recipient_id));
DROP POLICY IF EXISTS "Mark my messages read" ON direct_messages;
CREATE POLICY "Mark my messages read" ON direct_messages
  FOR UPDATE USING (auth.uid() = recipient_id);
DROP POLICY IF EXISTS "Delete my own messages" ON direct_messages;
CREATE POLICY "Delete my own messages" ON direct_messages
  FOR DELETE USING (auth.uid() = sender_id);
-- Recipients may only change read_at.
REVOKE UPDATE ON direct_messages FROM authenticated;
GRANT UPDATE (read_at) ON direct_messages TO authenticated;

-- ───────────────────────── 4. GAMES ─────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  course_name text,
  format text NOT NULL CHECK (format IN ('stroke', 'best_ball', 'scramble', 'skins', 'nassau', 'stableford', 'match')),
  settings jsonb NOT NULL DEFAULT '{}',   -- holes, pars, stroke index, handicap use, skin value…
  players jsonb NOT NULL DEFAULT '[]',    -- [{id, user_id?, name, handicap, team}]
  scores jsonb NOT NULL DEFAULT '{}',     -- {playerOrTeamId: [strokes per hole]}
  participant_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'final')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_participants_idx ON games USING gin (participant_ids);
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Players can see their games" ON games;
CREATE POLICY "Players can see their games" ON games
  FOR SELECT USING (
    auth.uid() = created_by OR auth.uid() = ANY (participant_ids)
    OR (group_id IS NOT NULL AND group_id IN (SELECT get_my_group_ids(auth.uid())))
  );
DROP POLICY IF EXISTS "Anyone signed in can start a game" ON games;
CREATE POLICY "Anyone signed in can start a game" ON games
  FOR INSERT WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "Players can enter scores" ON games;
CREATE POLICY "Players can enter scores" ON games
  FOR UPDATE USING (auth.uid() = created_by OR auth.uid() = ANY (participant_ids));
DROP POLICY IF EXISTS "Creator can delete a game" ON games;
CREATE POLICY "Creator can delete a game" ON games
  FOR DELETE USING (auth.uid() = created_by);

-- Only the creator can change who is in the game.
CREATE OR REPLACE FUNCTION guard_games() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.uid() IS NOT NULL AND auth.uid() <> OLD.created_by AND
     (NEW.participant_ids IS DISTINCT FROM OLD.participant_ids OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.players IS DISTINCT FROM OLD.players OR NEW.format IS DISTINCT FROM OLD.format) THEN
    RAISE EXCEPTION 'Only the scorekeeper who started the game can change its setup';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS games_guard ON games;
CREATE TRIGGER games_guard BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION guard_games();

-- ───────────────────────── 5. AI INSIGHT CACHE ─────────────────────────
-- Written only by the player-insight Edge Function, so the AI runs once per new round.
CREATE TABLE IF NOT EXISTS player_insights (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  insight text NOT NULL,
  latest_round_at timestamptz,
  rounds_considered int,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE player_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read my insight" ON player_insights;
CREATE POLICY "Read my insight" ON player_insights FOR SELECT USING (auth.uid() = user_id);

-- ───────────────────────── 6. REALTIME ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['group_messages', 'direct_messages', 'games'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
