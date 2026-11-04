-- =====================================================================
-- ForeSome — Community layer, Phase 1 (events, registration, pairings,
-- check-in, live leaderboards, seasons & points, role-based access)
-- Adapted from 20261101_community_layer.sql to this project's schema:
--   • creates public.courses (seeded below with the app's 86 KC courses, same ids)
--   • rounds.id is text here, so round links are text
--   • fees are recorded as "pay at course" (Stripe arrives in Phase 2)
--   • adds platform admins (QMS) and a public leaderboard function for TV mode
-- Run AFTER 2026-11-golfer-features.sql. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums (created only if missing)
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.org_role            AS ENUM ('owner', 'admin', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.community_role      AS ENUM ('owner', 'admin', 'co_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.community_privacy   AS ENUM ('public', 'closed', 'secret');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.membership_status   AS ENUM ('pending', 'active', 'past_due', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.event_format        AS ENUM ('stroke', 'scramble', 'best_ball', 'skins', 'stableford', 'match_play', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.event_visibility    AS ENUM ('public', 'members_only', 'unlisted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.event_status        AS ENUM ('draft', 'published', 'live', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.registration_status AS ENUM ('pending_payment', 'confirmed', 'waitlisted', 'cancelled', 'checked_in');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.point_rule_type     AS ENUM ('finish', 'participation', 'course_bonus');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Platform admins (QMS) and operators
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,48}$'),
  timezone    text NOT NULL DEFAULT 'America/Chicago',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_staff (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            public.org_role NOT NULL DEFAULT 'staff',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.courses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  city            text,
  state           text,
  address         text,
  latitude        double precision,
  longitude       double precision,
  par             integer,
  course_type     text,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Communities (leagues, clubs, tours, outings)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,48}$'),
  name            text NOT NULL,
  description     text,
  logo_url        text,
  cover_url       text,
  brand_color     text,
  privacy         public.community_privacy NOT NULL DEFAULT 'public',
  home_course_id  uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  timezone        text NOT NULL DEFAULT 'America/Chicago',
  created_by      uuid NOT NULL REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.community_admins (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role         public.community_role NOT NULL DEFAULT 'admin',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status        public.membership_status NOT NULL DEFAULT 'pending',
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, profile_id)
);

-- ---------------------------------------------------------------------
-- Seasons and points
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seasons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  community_id     uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  invite_top_n     integer CHECK (invite_top_n > 0),     -- top N unlock invite-only outings
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(community_id, organization_id) = 1),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS public.season_point_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  rule_type  public.point_rule_type NOT NULL,
  position   integer CHECK (position > 0),
  points     integer NOT NULL CHECK (points >= 0),
  CHECK ((rule_type = 'finish') = (position IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS season_point_rules_unique
  ON public.season_point_rules (season_id, rule_type, coalesce(position, 0));

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  description             text,
  course_id               uuid NOT NULL REFERENCES public.courses(id),
  community_id            uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  organization_id         uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  season_id               uuid REFERENCES public.seasons(id) ON DELETE SET NULL,
  created_by              uuid NOT NULL REFERENCES public.profiles(id),
  format                  public.event_format NOT NULL DEFAULT 'stroke',
  team_size               integer NOT NULL DEFAULT 1 CHECK (team_size BETWEEN 1 AND 4),
  starts_at               timestamptz NOT NULL,
  shotgun_start           boolean NOT NULL DEFAULT false,
  tee_interval_minutes    integer NOT NULL DEFAULT 10 CHECK (tee_interval_minutes BETWEEN 5 AND 30),
  teequest_ref            text,
  capacity                integer CHECK (capacity > 0),
  registration_opens_at   timestamptz,
  registration_closes_at  timestamptz,
  visibility              public.event_visibility NOT NULL DEFAULT 'public',
  status                  public.event_status NOT NULL DEFAULT 'draft',
  allow_waitlist          boolean NOT NULL DEFAULT true,
  invite_only_top_n       integer CHECK (invite_only_top_n > 0),   -- only top N in the season may register
  questions               jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{id,label,type:'text'|'select'|'checkbox',options?,required?}]
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_course_starts_idx ON public.events (course_id, starts_at);
CREATE INDEX IF NOT EXISTS events_community_idx     ON public.events (community_id);
CREATE INDEX IF NOT EXISTS events_season_idx        ON public.events (season_id);

CREATE TABLE IF NOT EXISTS public.event_ticket_types (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name               text NOT NULL,
  price_cents        integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  member_price_cents integer CHECK (member_price_cents >= 0),
  members_only       boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.event_teams (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name                text NOT NULL,
  captain_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,
  event_id         uuid REFERENCES public.events(id) ON DELETE CASCADE,
  community_id     uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  percent_off      integer CHECK (percent_off BETWEEN 1 AND 100),
  amount_off_cents integer CHECK (amount_off_cents > 0),
  max_uses         integer CHECK (max_uses > 0),
  used_count       integer NOT NULL DEFAULT 0,
  expires_at       timestamptz,
  CHECK (num_nonnulls(event_id, community_id) = 1),
  CHECK (num_nonnulls(percent_off, amount_off_cents) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_unique
  ON public.discount_codes (lower(code), coalesce(event_id, community_id));

CREATE TABLE IF NOT EXISTS public.registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ticket_type_id    uuid REFERENCES public.event_ticket_types(id) ON DELETE SET NULL,
  team_id           uuid REFERENCES public.event_teams(id) ON DELETE SET NULL,
  discount_code_id  uuid REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  status            public.registration_status NOT NULL DEFAULT 'confirmed',
  waitlist_position integer,
  amount_due_cents  integer NOT NULL DEFAULT 0 CHECK (amount_due_cents >= 0),
  paid_at_course_at timestamptz,          -- staff marks the fee collected (Phase 1)
  flight            text,
  handicap          numeric(4,1),
  answers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  round_id          text REFERENCES public.rounds(id) ON DELETE SET NULL,
  hold_expires_at   timestamptz,
  promoted_at       timestamptz,
  checked_in_at     timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS registrations_one_active_per_player
  ON public.registrations (event_id, profile_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS registrations_event_status_idx ON public.registrations (event_id, status);
CREATE INDEX IF NOT EXISTS registrations_waitlist_idx
  ON public.registrations (event_id, waitlist_position) WHERE status = 'waitlisted';

CREATE TABLE IF NOT EXISTS public.pairings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  group_number    integer NOT NULL,
  starting_hole   integer NOT NULL DEFAULT 1 CHECK (starting_hole BETWEEN 1 AND 18),
  tee_time        timestamptz,
  cart_sign_label text,
  UNIQUE (event_id, group_number)
);

CREATE TABLE IF NOT EXISTS public.pairing_players (
  pairing_id      uuid NOT NULL REFERENCES public.pairings(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL UNIQUE REFERENCES public.registrations(id) ON DELETE CASCADE,
  is_scorer       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (pairing_id, registration_id)
);

CREATE TABLE IF NOT EXISTS public.event_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL UNIQUE REFERENCES public.registrations(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  round_id        text REFERENCES public.rounds(id) ON DELETE SET NULL,
  hole_scores     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- same shape as rounds.hole_scores
  gross           integer,
  net             integer,
  to_par          integer,
  thru            integer NOT NULL DEFAULT 0 CHECK (thru BETWEEN 0 AND 18),
  final_position  integer,
  is_final        boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_results_event_idx ON public.event_results (event_id);

CREATE TABLE IF NOT EXISTS public.season_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES public.courses(id),
  rule_type   public.point_rule_type NOT NULL,
  points      integer NOT NULL,
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, profile_id, event_id, rule_type)
);
CREATE INDEX IF NOT EXISTS season_points_season_profile_idx ON public.season_points (season_id, profile_id);

-- In-app notifications (waitlist promotions, reminders). Push/email arrive with the notify function.
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_outbox_profile_idx ON public.notification_outbox (profile_id, created_at DESC);

-- =====================================================================
-- Permission helpers (security definer so policies don't recurse).
-- Platform admins (QMS) pass every check.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE profile_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_community_role(c uuid, roles public.community_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin() OR EXISTS (SELECT 1 FROM community_admins
    WHERE community_id = c AND profile_id = auth.uid() AND role = ANY(roles));
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(o uuid, roles public.org_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin() OR EXISTS (SELECT 1 FROM organization_staff
    WHERE organization_id = o AND profile_id = auth.uid() AND role = ANY(roles));
$$;

CREATE OR REPLACE FUNCTION public.is_community_admin(c uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin() OR EXISTS (SELECT 1 FROM community_admins
    WHERE community_id = c AND profile_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_community_member(c uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_community_admin(c) OR EXISTS (SELECT 1 FROM memberships
    WHERE community_id = c AND profile_id = auth.uid() AND status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.is_org_staff(o uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin() OR EXISTS (SELECT 1 FROM organization_staff
    WHERE organization_id = o AND profile_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event(e uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM events ev LEFT JOIN courses co ON co.id = ev.course_id
    WHERE ev.id = e AND (
         ev.created_by = auth.uid()
      OR (ev.community_id    IS NOT NULL AND public.is_community_admin(ev.community_id))
      OR (ev.organization_id IS NOT NULL AND public.is_org_staff(ev.organization_id))
      OR (co.organization_id IS NOT NULL AND public.is_org_staff(co.organization_id))));
$$;

CREATE OR REPLACE FUNCTION public.can_view_event(e uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM events ev WHERE ev.id = e AND (
         (ev.status <> 'draft' AND ev.visibility IN ('public', 'unlisted'))
      OR (ev.status <> 'draft' AND ev.visibility = 'members_only'
          AND ev.community_id IS NOT NULL AND public.is_community_member(ev.community_id))
      OR EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = ev.id AND r.profile_id = auth.uid())))
    OR public.can_manage_event(e);
$$;

CREATE OR REPLACE FUNCTION public.can_view_community(c uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM communities WHERE id = c AND privacy <> 'secret')
      OR public.is_community_member(c)
      OR EXISTS (SELECT 1 FROM memberships WHERE community_id = c AND profile_id = auth.uid());
$$;

-- Event's group scorer may enter scores for the players in their group.
CREATE OR REPLACE FUNCTION public.can_score_registration(p_registration_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM registrations r WHERE r.id = p_registration_id AND r.profile_id = auth.uid())
      OR EXISTS (SELECT 1 FROM pairing_players me
                 JOIN pairing_players them ON them.pairing_id = me.pairing_id
                 JOIN registrations rme ON rme.id = me.registration_id
                 WHERE me.is_scorer AND rme.profile_id = auth.uid()
                   AND them.registration_id = p_registration_id)
      OR EXISTS (SELECT 1 FROM registrations r WHERE r.id = p_registration_id AND public.can_manage_event(r.event_id));
$$;

-- =====================================================================
-- Triggers
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tg_community_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO community_admins (community_id, profile_id, role) VALUES (NEW.id, NEW.created_by, 'owner')
  ON CONFLICT DO NOTHING;
  INSERT INTO memberships (community_id, profile_id, status) VALUES (NEW.id, NEW.created_by, 'active')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS community_owner_after_insert ON public.communities;
CREATE TRIGGER community_owner_after_insert AFTER INSERT ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_owner();

CREATE OR REPLACE FUNCTION public.holds_spot(s public.registration_status)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT s IN ('pending_payment', 'confirmed', 'checked_in'); $$;

-- Full event → waitlist (row lock stops two sign-ups taking the last spot)
CREATE OR REPLACE FUNCTION public.tg_registration_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev events%ROWTYPE; taken integer;
BEGIN
  IF NOT public.holds_spot(NEW.status) THEN RETURN NEW; END IF;
  SELECT * INTO ev FROM events WHERE id = NEW.event_id FOR UPDATE;
  IF ev.capacity IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO taken FROM registrations WHERE event_id = NEW.event_id AND public.holds_spot(status);
  IF taken >= ev.capacity THEN
    IF NOT ev.allow_waitlist THEN RAISE EXCEPTION 'Event is full' USING errcode = 'P0001'; END IF;
    NEW.status := 'waitlisted';
    NEW.hold_expires_at := NULL;
    SELECT coalesce(max(waitlist_position), 0) + 1 INTO NEW.waitlist_position
      FROM registrations WHERE event_id = NEW.event_id AND status = 'waitlisted';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS registration_capacity_before_insert ON public.registrations;
CREATE TRIGGER registration_capacity_before_insert BEFORE INSERT ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_registration_capacity();

-- A freed spot promotes the next waitlisted player and tells them
CREATE OR REPLACE FUNCTION public.tg_registration_promote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev events%ROWTYPE; nxt registrations%ROWTYPE;
BEGIN
  IF NOT (public.holds_spot(OLD.status) AND NEW.status = 'cancelled') THEN RETURN NEW; END IF;
  SELECT * INTO ev FROM events WHERE id = NEW.event_id FOR UPDATE;
  SELECT * INTO nxt FROM registrations
   WHERE event_id = NEW.event_id AND status = 'waitlisted'
   ORDER BY waitlist_position, created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    UPDATE registrations SET status = 'confirmed', waitlist_position = NULL, promoted_at = now() WHERE id = nxt.id;
    -- close the gap in the waitlist
    UPDATE registrations SET waitlist_position = waitlist_position - 1
     WHERE event_id = NEW.event_id AND status = 'waitlisted' AND waitlist_position > nxt.waitlist_position;
    INSERT INTO notification_outbox (profile_id, kind, payload)
    VALUES (nxt.profile_id, 'waitlist_promoted',
            jsonb_build_object('event_id', ev.id, 'event_name', ev.name, 'registration_id', nxt.id,
                               'amount_due_cents', nxt.amount_due_cents));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS registration_promote_after_update ON public.registrations;
CREATE TRIGGER registration_promote_after_update AFTER UPDATE OF status ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_registration_promote();

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS event_results_touch ON public.event_results;
CREATE TRIGGER event_results_touch BEFORE UPDATE ON public.event_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =====================================================================
-- RPCs — golfers register, cancel, check in and score through these.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.season_rank(p_season uuid, p_profile uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pos FROM (
    SELECT profile_id, rank() OVER (ORDER BY sum(points) DESC) AS pos
    FROM season_points WHERE season_id = p_season GROUP BY profile_id) s
  WHERE profile_id = p_profile;
$$;

CREATE OR REPLACE FUNCTION public.register_for_event(
  p_event_id uuid, p_ticket_type_id uuid DEFAULT NULL, p_team_id uuid DEFAULT NULL,
  p_answers jsonb DEFAULT '{}'::jsonb, p_discount_code text DEFAULT NULL
) RETURNS public.registrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev events%ROWTYPE; tt event_ticket_types%ROWTYPE; dc discount_codes%ROWTYPE;
  is_mem boolean := false; price integer := 0; reg registrations%ROWTYPE; q jsonb; hcp numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING errcode = '28000'; END IF;
  SELECT * INTO ev FROM events WHERE id = p_event_id;
  IF NOT FOUND OR ev.status NOT IN ('published', 'live') THEN
    RAISE EXCEPTION 'This event is not open for registration' USING errcode = 'P0001';
  END IF;
  IF (ev.registration_opens_at IS NOT NULL AND now() < ev.registration_opens_at)
     OR (ev.registration_closes_at IS NOT NULL AND now() > ev.registration_closes_at) THEN
    RAISE EXCEPTION 'Registration is closed' USING errcode = 'P0001';
  END IF;
  IF ev.community_id IS NOT NULL THEN is_mem := public.is_community_member(ev.community_id); END IF;
  IF ev.visibility = 'members_only' AND NOT is_mem THEN
    RAISE EXCEPTION 'This event is for members only' USING errcode = '42501';
  END IF;
  IF ev.invite_only_top_n IS NOT NULL AND NOT public.can_manage_event(ev.id) THEN
    IF ev.season_id IS NULL OR coalesce(public.season_rank(ev.season_id, auth.uid()), 999999) > ev.invite_only_top_n THEN
      RAISE EXCEPTION 'Invite only: top % in the season standings', ev.invite_only_top_n USING errcode = '42501';
    END IF;
  END IF;

  -- required questions (e.g. waiver)
  FOR q IN SELECT * FROM jsonb_array_elements(ev.questions) LOOP
    IF coalesce((q->>'required')::boolean, false)
       AND coalesce(nullif(p_answers->>(q->>'id'), ''), 'false') IN ('false') THEN
      RAISE EXCEPTION 'Please answer: %', q->>'label' USING errcode = 'P0001';
    END IF;
  END LOOP;

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT * INTO tt FROM event_ticket_types WHERE id = p_ticket_type_id AND event_id = p_event_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid ticket type' USING errcode = 'P0001'; END IF;
    IF tt.members_only AND NOT is_mem THEN RAISE EXCEPTION 'That entry is for members only' USING errcode = '42501'; END IF;
    price := CASE WHEN is_mem AND tt.member_price_cents IS NOT NULL THEN tt.member_price_cents ELSE tt.price_cents END;
  END IF;

  IF nullif(trim(p_discount_code), '') IS NOT NULL THEN
    SELECT * INTO dc FROM discount_codes
     WHERE lower(code) = lower(trim(p_discount_code))
       AND (event_id = p_event_id OR (ev.community_id IS NOT NULL AND community_id = ev.community_id))
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That discount code is not valid' USING errcode = 'P0001'; END IF;
    price := greatest(0, CASE WHEN dc.percent_off IS NOT NULL THEN price - (price * dc.percent_off / 100)
                              ELSE price - dc.amount_off_cents END);
    UPDATE discount_codes SET used_count = used_count + 1 WHERE id = dc.id;
  END IF;

  IF p_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_teams WHERE id = p_team_id AND event_id = p_event_id) THEN
    RAISE EXCEPTION 'Invalid team' USING errcode = 'P0001';
  END IF;

  SELECT handicap INTO hcp FROM profiles WHERE id = auth.uid();
  INSERT INTO registrations (event_id, profile_id, ticket_type_id, team_id, discount_code_id,
                             status, amount_due_cents, answers, handicap)
  VALUES (p_event_id, auth.uid(), p_ticket_type_id, p_team_id, dc.id,
          'confirmed', price, coalesce(p_answers, '{}'::jsonb), hcp)
  RETURNING * INTO reg;
  RETURN reg;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You are already registered for this event' USING errcode = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION public.cancel_registration(p_registration_id uuid)
RETURNS public.registrations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reg registrations%ROWTYPE;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND OR (reg.profile_id <> auth.uid() AND NOT public.can_manage_event(reg.event_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING errcode = '42501';
  END IF;
  UPDATE registrations SET status = 'cancelled', cancelled_at = now(), waitlist_position = NULL
   WHERE id = p_registration_id AND status <> 'cancelled' RETURNING * INTO reg;
  RETURN reg;
END $$;

CREATE OR REPLACE FUNCTION public.check_in(p_registration_id uuid)
RETURNS public.registrations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reg registrations%ROWTYPE; ev events%ROWTYPE;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found' USING errcode = 'P0002'; END IF;
  SELECT * INTO ev FROM events WHERE id = reg.event_id;
  IF NOT public.can_manage_event(ev.id) THEN
    IF reg.profile_id <> auth.uid() THEN
      RAISE EXCEPTION 'Not allowed' USING errcode = '42501';
    END IF;
    IF (ev.starts_at AT TIME ZONE 'America/Chicago')::date <> (now() AT TIME ZONE 'America/Chicago')::date THEN
      RAISE EXCEPTION 'Self check-in opens on event day' USING errcode = '42501';
    END IF;
  END IF;
  IF reg.status = 'checked_in' THEN RETURN reg; END IF;
  IF reg.status <> 'confirmed' THEN RAISE EXCEPTION 'Registration is %', reg.status USING errcode = 'P0001'; END IF;
  UPDATE registrations SET status = 'checked_in', checked_in_at = now() WHERE id = p_registration_id RETURNING * INTO reg;
  RETURN reg;
END $$;

-- Staff record the entry fee collected at the course (Phase 1, before Stripe)
CREATE OR REPLACE FUNCTION public.mark_paid_at_course(p_registration_id uuid, p_paid boolean DEFAULT true)
RETURNS public.registrations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reg registrations%ROWTYPE;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND OR NOT public.can_manage_event(reg.event_id) THEN RAISE EXCEPTION 'Not allowed' USING errcode = '42501'; END IF;
  UPDATE registrations SET paid_at_course_at = CASE WHEN p_paid THEN now() END WHERE id = p_registration_id RETURNING * INTO reg;
  RETURN reg;
END $$;

-- Live scoring: the player, their group's scorer, or an event manager
CREATE OR REPLACE FUNCTION public.save_event_score(
  p_registration_id uuid, p_hole_scores jsonb, p_gross integer, p_net integer, p_to_par integer, p_thru integer
) RETURNS public.event_results LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reg registrations%ROWTYPE; ev events%ROWTYPE; res event_results%ROWTYPE;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND OR NOT public.can_score_registration(p_registration_id) THEN
    RAISE EXCEPTION 'You can only score yourself or your group' USING errcode = '42501';
  END IF;
  SELECT * INTO ev FROM events WHERE id = reg.event_id;
  IF reg.status NOT IN ('confirmed', 'checked_in') THEN RAISE EXCEPTION 'Registration is %', reg.status USING errcode = 'P0001'; END IF;
  IF ev.status NOT IN ('published', 'live') AND NOT public.can_manage_event(ev.id) THEN
    RAISE EXCEPTION 'Scoring is closed for this event' USING errcode = 'P0001';
  END IF;
  SELECT * INTO res FROM event_results WHERE registration_id = p_registration_id;
  IF FOUND AND res.is_final AND NOT public.can_manage_event(ev.id) THEN
    RAISE EXCEPTION 'Scores are final' USING errcode = 'P0001';
  END IF;
  INSERT INTO event_results (event_id, registration_id, profile_id, hole_scores, gross, net, to_par, thru)
  VALUES (reg.event_id, reg.id, reg.profile_id, coalesce(p_hole_scores, '[]'::jsonb), p_gross, p_net, p_to_par, least(greatest(coalesce(p_thru, 0), 0), 18))
  ON CONFLICT (registration_id) DO UPDATE
    SET hole_scores = EXCLUDED.hole_scores, gross = EXCLUDED.gross, net = EXCLUDED.net,
        to_par = EXCLUDED.to_par, thru = EXCLUDED.thru
  RETURNING * INTO res;
  IF ev.status = 'published' THEN UPDATE events SET status = 'live' WHERE id = ev.id; END IF;
  RETURN res;
END $$;

-- Award season points for a finished event
CREATE OR REPLACE FUNCTION public.award_event_points(p_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev events%ROWTYPE; n integer;
BEGIN
  IF NOT public.can_manage_event(p_event_id) THEN RAISE EXCEPTION 'Not allowed' USING errcode = '42501'; END IF;
  SELECT * INTO ev FROM events WHERE id = p_event_id;
  IF ev.season_id IS NULL THEN RETURN 0; END IF;
  DELETE FROM season_points WHERE event_id = p_event_id;
  INSERT INTO season_points (season_id, profile_id, event_id, course_id, rule_type, points)
  SELECT ev.season_id, er.profile_id, ev.id, ev.course_id, 'participation', r.points
    FROM event_results er JOIN season_point_rules r ON r.season_id = ev.season_id AND r.rule_type = 'participation'
   WHERE er.event_id = ev.id AND er.is_final;
  INSERT INTO season_points (season_id, profile_id, event_id, course_id, rule_type, points)
  SELECT ev.season_id, er.profile_id, ev.id, ev.course_id, 'finish', r.points
    FROM event_results er JOIN season_point_rules r ON r.season_id = ev.season_id AND r.rule_type = 'finish'
                                                   AND r.position = er.final_position
   WHERE er.event_id = ev.id AND er.is_final;
  INSERT INTO season_points (season_id, profile_id, event_id, course_id, rule_type, points)
  SELECT ev.season_id, er.profile_id, ev.id, ev.course_id, 'course_bonus', r.points
    FROM event_results er JOIN season_point_rules r ON r.season_id = ev.season_id AND r.rule_type = 'course_bonus'
   WHERE er.event_id = ev.id AND er.is_final
     AND NOT EXISTS (SELECT 1 FROM season_points sp WHERE sp.season_id = ev.season_id AND sp.profile_id = er.profile_id
                       AND sp.course_id = ev.course_id AND sp.rule_type = 'course_bonus');
  SELECT count(*) INTO n FROM season_points WHERE event_id = p_event_id;
  RETURN n;
END $$;

-- Finish an event: lock scores, set positions, save each player's round to their
-- history (so it counts in course rankings and AI insight), then award points.
CREATE OR REPLACE FUNCTION public.finalize_event(p_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev events%ROWTYPE; cname text; n integer;
BEGIN
  IF NOT public.can_manage_event(p_event_id) THEN RAISE EXCEPTION 'Not allowed' USING errcode = '42501'; END IF;
  SELECT * INTO ev FROM events WHERE id = p_event_id;
  SELECT name INTO cname FROM courses WHERE id = ev.course_id;

  UPDATE event_results er SET final_position = x.pos, is_final = true
    FROM (SELECT id, rank() OVER (ORDER BY to_par, gross) AS pos
            FROM event_results WHERE event_id = p_event_id AND thru = 18) x
   WHERE er.id = x.id;

  INSERT INTO rounds (id, user_id, course_id, course_name, tee, created_at, hole_scores, summary, completed_holes)
  SELECT 'evt-' || er.registration_id, er.profile_id, ev.course_id::text, cname, 'Event', ev.starts_at, er.hole_scores,
         jsonb_build_object(
           'score', er.gross,
           'putts', (SELECT sum(coalesce((h->>'putts')::int, 0)) FROM jsonb_array_elements(er.hole_scores) h),
           'gir',   (SELECT count(*) FROM jsonb_array_elements(er.hole_scores) h WHERE (h->>'gir')::boolean),
           'fir',   (SELECT count(*) FROM jsonb_array_elements(er.hole_scores) h WHERE (h->>'fir')::boolean),
           'event_id', ev.id),
         18
    FROM event_results er WHERE er.event_id = p_event_id AND er.is_final
  ON CONFLICT (id) DO NOTHING;
  UPDATE event_results SET round_id = 'evt-' || registration_id WHERE event_id = p_event_id AND is_final AND round_id IS NULL;
  UPDATE registrations r SET round_id = er.round_id FROM event_results er WHERE er.registration_id = r.id AND er.event_id = p_event_id;

  UPDATE events SET status = 'completed' WHERE id = p_event_id;
  n := public.award_event_points(p_event_id);
  RETURN n;
END $$;

-- =====================================================================
-- Read functions (names included; safe for the public TV screen)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.event_is_public(e uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM events WHERE id = e AND status <> 'draft' AND visibility IN ('public', 'unlisted'));
$$;

CREATE OR REPLACE FUNCTION public.event_leaderboard(p_event_id uuid)
RETURNS TABLE(registration_id uuid, profile_id uuid, username text, initials text, team_name text, flight text,
              gross integer, net integer, to_par integer, thru integer, is_final boolean, place bigint, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.profile_id, p.username, p.initials, t.name, r.flight,
         er.gross, er.net, er.to_par, coalesce(er.thru, 0), coalesce(er.is_final, false),
         rank() OVER (PARTITION BY r.flight ORDER BY er.to_par NULLS LAST, er.thru DESC NULLS LAST),
         er.updated_at
    FROM registrations r
    JOIN profiles p ON p.id = r.profile_id
    LEFT JOIN event_teams t ON t.id = r.team_id
    LEFT JOIN event_results er ON er.registration_id = r.id
   WHERE r.event_id = p_event_id AND r.status IN ('confirmed', 'checked_in')
     AND (public.event_is_public(p_event_id) OR public.can_view_event(p_event_id))
   ORDER BY 12, p.username;
$$;

CREATE OR REPLACE FUNCTION public.public_event(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'event', to_jsonb(ev) - 'teequest_ref',
    'course', jsonb_build_object('id', co.id, 'name', co.name, 'city', co.city, 'state', co.state, 'address', co.address),
    'community', CASE WHEN cm.id IS NULL THEN NULL ELSE jsonb_build_object('id', cm.id, 'name', cm.name, 'slug', cm.slug, 'logo_url', cm.logo_url) END,
    'confirmed', (SELECT count(*) FROM registrations WHERE event_id = ev.id AND status IN ('confirmed', 'checked_in', 'pending_payment')),
    'waitlisted', (SELECT count(*) FROM registrations WHERE event_id = ev.id AND status = 'waitlisted'),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order) FROM event_ticket_types t WHERE t.event_id = ev.id), '[]'::jsonb))
  FROM events ev JOIN courses co ON co.id = ev.course_id LEFT JOIN communities cm ON cm.id = ev.community_id
  WHERE ev.id = p_event_id AND (public.event_is_public(ev.id) OR public.can_view_event(ev.id));
$$;

CREATE OR REPLACE FUNCTION public.season_standings(p_season_id uuid)
RETURNS TABLE(profile_id uuid, username text, initials text, points integer, events_played integer, courses_played integer, place bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sp.profile_id, p.username, p.initials, sum(sp.points)::int, count(DISTINCT sp.event_id)::int,
         count(DISTINCT sp.course_id)::int, rank() OVER (ORDER BY sum(sp.points) DESC)
    FROM season_points sp JOIN profiles p ON p.id = sp.profile_id
   WHERE sp.season_id = p_season_id
   GROUP BY sp.profile_id, p.username, p.initials
   ORDER BY 7, 2;
$$;

-- Every role the signed-in user holds, for role-based screens
CREATE OR REPLACE FUNCTION public.my_roles()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'platform_admin', public.is_platform_admin(),
    'organizations', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', s.role) ORDER BY o.name)
                                 FROM organization_staff s JOIN organizations o ON o.id = s.organization_id
                                WHERE s.profile_id = auth.uid()), '[]'::jsonb),
    'communities', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'role', a.role) ORDER BY c.name)
                               FROM community_admins a JOIN communities c ON c.id = a.community_id
                              WHERE a.profile_id = auth.uid()), '[]'::jsonb),
    'memberships', coalesce((SELECT jsonb_agg(jsonb_build_object('community_id', m.community_id, 'status', m.status))
                               FROM memberships m WHERE m.profile_id = auth.uid()), '[]'::jsonb));
$$;

-- Join a community: public → member now, closed → request, secret → invite only
CREATE OR REPLACE FUNCTION public.join_community(p_community_id uuid)
RETURNS public.memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c communities%ROWTYPE; m memberships%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING errcode = '28000'; END IF;
  SELECT * INTO c FROM communities WHERE id = p_community_id;
  IF NOT FOUND OR c.privacy = 'secret' THEN RAISE EXCEPTION 'This community is invite only' USING errcode = '42501'; END IF;
  INSERT INTO memberships (community_id, profile_id, status)
  VALUES (p_community_id, auth.uid(), CASE WHEN c.privacy = 'public' THEN 'active'::membership_status ELSE 'pending'::membership_status END)
  ON CONFLICT (community_id, profile_id) DO UPDATE
    SET status = CASE WHEN memberships.status = 'cancelled' THEN EXCLUDED.status ELSE memberships.status END
  RETURNING * INTO m;
  RETURN m;
END $$;

-- Operator dashboard: Events & Groups panels for one organization
CREATE OR REPLACE FUNCTION public.org_dashboard(p_org_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  IF NOT public.is_org_staff(p_org_id) THEN RAISE EXCEPTION 'Not allowed' USING errcode = '42501'; END IF;
  WITH oc AS (SELECT id, name FROM courses WHERE organization_id = p_org_id),
  ev AS (SELECT e.* FROM events e WHERE e.course_id IN (SELECT id FROM oc) OR e.organization_id = p_org_id),
  rg AS (SELECT r.*, e.course_id, e.community_id, e.starts_at FROM registrations r JOIN ev e ON e.id = r.event_id)
  SELECT jsonb_build_object(
    'courses', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]') FROM oc),
    'upcoming', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'starts_at'), '[]') FROM (
        SELECT jsonb_build_object('id', e.id, 'name', e.name, 'starts_at', e.starts_at, 'status', e.status,
          'course', (SELECT name FROM courses WHERE id = e.course_id), 'capacity', e.capacity,
          'registered', (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND public.holds_spot(r.status)),
          'waitlist', (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted'),
          'checked_in', (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'checked_in')) AS x
        FROM ev e WHERE e.starts_at::date BETWEEN p_from AND p_to AND e.status <> 'cancelled') s),
    'checkins_today', (SELECT count(*) FROM rg WHERE (checked_in_at AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date),
    'top_communities', (SELECT coalesce(jsonb_agg(t ORDER BY (t->>'entries')::int DESC), '[]') FROM (
        SELECT jsonb_build_object('id', c.id, 'name', c.name,
          'entries', count(*) FILTER (WHERE public.holds_spot(rg.status)),
          'events', count(DISTINCT rg.event_id)) AS t
        FROM rg JOIN communities c ON c.id = rg.community_id
        WHERE rg.starts_at::date BETWEEN p_from AND p_to GROUP BY c.id, c.name LIMIT 10) s),
    'cross_course_players', (SELECT count(*) FROM (
        SELECT profile_id FROM rg WHERE rg.status IN ('checked_in') AND rg.starts_at::date BETWEEN p_from AND p_to
        GROUP BY profile_id HAVING count(DISTINCT course_id) >= 2) s),
    'entries_total', (SELECT count(*) FROM rg WHERE public.holds_spot(status) AND starts_at::date BETWEEN p_from AND p_to),
    'fees_due_cents', (SELECT coalesce(sum(amount_due_cents), 0) FROM rg WHERE public.holds_spot(status) AND starts_at::date BETWEEN p_from AND p_to),
    'fees_collected_cents', (SELECT coalesce(sum(amount_due_cents), 0) FROM rg WHERE paid_at_course_at IS NOT NULL AND starts_at::date BETWEEN p_from AND p_to)
  ) INTO out;
  RETURN out;
END $$;

-- =====================================================================
-- Row-level security
-- =====================================================================
ALTER TABLE public.platform_admins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_staff  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_admins    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_point_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticket_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_codes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairing_players     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_points       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Drop policies first so the file can be re-run.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN (
    'platform_admins','organizations','organization_staff','courses','communities','community_admins','memberships',
    'seasons','season_point_rules','events','event_ticket_types','event_teams','discount_codes','registrations',
    'pairings','pairing_players','event_results','season_points','notification_outbox')
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename); END LOOP;
END $$;

-- Platform admins (add the first one in the SQL editor: insert into platform_admins values ('<your profile id>');)
CREATE POLICY platform_admins_read ON public.platform_admins FOR SELECT USING (profile_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY platform_admins_manage ON public.platform_admins FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- Organizations: readable by signed-in users; created by platform admins; edited by owners/admins
CREATE POLICY org_read ON public.organizations FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY org_create ON public.organizations FOR INSERT WITH CHECK (public.is_platform_admin());
CREATE POLICY org_update ON public.organizations FOR UPDATE USING (public.has_org_role(id, '{owner,admin}'));
CREATE POLICY org_delete ON public.organizations FOR DELETE USING (public.is_platform_admin());

CREATE POLICY org_staff_read ON public.organization_staff FOR SELECT
  USING (profile_id = auth.uid() OR public.is_org_staff(organization_id));
CREATE POLICY org_staff_manage ON public.organization_staff FOR ALL
  USING (public.has_org_role(organization_id, '{owner,admin}'))
  WITH CHECK (public.has_org_role(organization_id, '{owner,admin}') AND (role <> 'owner' OR public.has_org_role(organization_id, '{owner}')));

-- Courses: readable by everyone signed in; platform admins assign operators
CREATE POLICY courses_read ON public.courses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY courses_manage ON public.courses FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- Communities
CREATE POLICY community_read ON public.communities FOR SELECT USING (public.can_view_community(id));
CREATE POLICY community_create ON public.communities FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY community_update ON public.communities FOR UPDATE USING (public.is_community_admin(id)) WITH CHECK (public.is_community_admin(id));
CREATE POLICY community_delete ON public.communities FOR DELETE USING (public.has_community_role(id, '{owner}'));

CREATE POLICY community_admins_read ON public.community_admins FOR SELECT USING (public.can_view_community(community_id));
-- owners/admins manage helpers; only the owner can add or remove admins or owners
CREATE POLICY community_admins_insert ON public.community_admins FOR INSERT
  WITH CHECK (public.has_community_role(community_id, '{owner}')
           OR (public.has_community_role(community_id, '{admin}') AND role = 'co_admin'));
CREATE POLICY community_admins_update ON public.community_admins FOR UPDATE
  USING (public.has_community_role(community_id, '{owner}')) WITH CHECK (public.has_community_role(community_id, '{owner}'));
CREATE POLICY community_admins_delete ON public.community_admins FOR DELETE
  USING (profile_id = auth.uid() AND role <> 'owner'
      OR public.has_community_role(community_id, '{owner}') AND role <> 'owner'
      OR public.has_community_role(community_id, '{admin}') AND role = 'co_admin');

-- Memberships (players join through join_community)
CREATE POLICY memberships_read ON public.memberships FOR SELECT
  USING (profile_id = auth.uid() OR public.is_community_member(community_id));
CREATE POLICY memberships_admin_add ON public.memberships FOR INSERT WITH CHECK (public.is_community_admin(community_id));
CREATE POLICY memberships_manage ON public.memberships FOR UPDATE
  USING (public.is_community_admin(community_id)) WITH CHECK (public.is_community_admin(community_id));
CREATE POLICY memberships_leave ON public.memberships FOR DELETE
  USING (profile_id = auth.uid() OR public.is_community_admin(community_id));

-- Seasons & rules
CREATE POLICY seasons_read ON public.seasons FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY seasons_manage ON public.seasons FOR ALL
  USING ((community_id IS NOT NULL AND public.is_community_admin(community_id)) OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id)))
  WITH CHECK ((community_id IS NOT NULL AND public.is_community_admin(community_id)) OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id)));
CREATE POLICY point_rules_read ON public.season_point_rules FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY point_rules_manage ON public.season_point_rules FOR ALL
  USING (EXISTS (SELECT 1 FROM seasons s WHERE s.id = season_id AND ((s.community_id IS NOT NULL AND public.is_community_admin(s.community_id)) OR (s.organization_id IS NOT NULL AND public.is_org_staff(s.organization_id)))))
  WITH CHECK (EXISTS (SELECT 1 FROM seasons s WHERE s.id = season_id AND ((s.community_id IS NOT NULL AND public.is_community_admin(s.community_id)) OR (s.organization_id IS NOT NULL AND public.is_org_staff(s.organization_id)))));

-- Events
CREATE POLICY events_read ON public.events FOR SELECT USING (public.can_view_event(id));
CREATE POLICY events_create ON public.events FOR INSERT
  WITH CHECK (created_by = auth.uid()
              AND (community_id IS NULL OR public.is_community_admin(community_id))
              AND (organization_id IS NULL OR public.is_org_staff(organization_id)));
CREATE POLICY events_update ON public.events FOR UPDATE USING (public.can_manage_event(id)) WITH CHECK (public.can_manage_event(id));
CREATE POLICY events_delete ON public.events FOR DELETE USING (public.can_manage_event(id));

CREATE POLICY ticket_types_read ON public.event_ticket_types FOR SELECT USING (public.can_view_event(event_id));
CREATE POLICY ticket_types_manage ON public.event_ticket_types FOR ALL
  USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));

CREATE POLICY teams_read ON public.event_teams FOR SELECT USING (public.can_view_event(event_id));
CREATE POLICY teams_create ON public.event_teams FOR INSERT
  WITH CHECK (public.can_manage_event(event_id) OR (captain_profile_id = auth.uid() AND public.can_view_event(event_id)));
CREATE POLICY teams_update ON public.event_teams FOR UPDATE USING (public.can_manage_event(event_id) OR captain_profile_id = auth.uid());
CREATE POLICY teams_delete ON public.event_teams FOR DELETE USING (public.can_manage_event(event_id));

CREATE POLICY discount_manage ON public.discount_codes FOR ALL
  USING ((event_id IS NOT NULL AND public.can_manage_event(event_id)) OR (community_id IS NOT NULL AND public.is_community_admin(community_id)))
  WITH CHECK ((event_id IS NOT NULL AND public.can_manage_event(event_id)) OR (community_id IS NOT NULL AND public.is_community_admin(community_id)));

-- Registrations: players read their own; managers read and change all. Players register/cancel/check in via RPCs.
CREATE POLICY registrations_read ON public.registrations FOR SELECT USING (profile_id = auth.uid() OR public.can_manage_event(event_id));
CREATE POLICY registrations_manage ON public.registrations FOR UPDATE
  USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));
CREATE POLICY registrations_manager_insert ON public.registrations FOR INSERT WITH CHECK (public.can_manage_event(event_id));

CREATE POLICY pairings_read ON public.pairings FOR SELECT USING (public.can_view_event(event_id));
CREATE POLICY pairings_manage ON public.pairings FOR ALL
  USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));
CREATE POLICY pairing_players_read ON public.pairing_players FOR SELECT
  USING (EXISTS (SELECT 1 FROM pairings p WHERE p.id = pairing_id AND public.can_view_event(p.event_id)));
CREATE POLICY pairing_players_manage ON public.pairing_players FOR ALL
  USING (EXISTS (SELECT 1 FROM pairings p WHERE p.id = pairing_id AND public.can_manage_event(p.event_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM pairings p WHERE p.id = pairing_id AND public.can_manage_event(p.event_id)));

-- Results: readable with the event; written through save_event_score / finalize_event; managers may edit
CREATE POLICY results_read ON public.event_results FOR SELECT USING (public.can_view_event(event_id));
CREATE POLICY results_manage ON public.event_results FOR ALL
  USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));

CREATE POLICY season_points_read ON public.season_points FOR SELECT USING (auth.role() = 'authenticated');

-- Notifications: your own; you may only mark them read
CREATE POLICY outbox_read_own ON public.notification_outbox FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY outbox_mark_read ON public.notification_outbox FOR UPDATE USING (profile_id = auth.uid());
REVOKE UPDATE ON public.notification_outbox FROM authenticated;
GRANT UPDATE (read_at) ON public.notification_outbox TO authenticated;

-- =====================================================================
-- Function grants
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.register_for_event(uuid, uuid, uuid, jsonb, text), public.cancel_registration(uuid),
  public.check_in(uuid), public.mark_paid_at_course(uuid, boolean), public.save_event_score(uuid, jsonb, integer, integer, integer, integer),
  public.award_event_points(uuid), public.finalize_event(uuid), public.my_roles(), public.join_community(uuid),
  public.org_dashboard(uuid, date, date), public.season_standings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, uuid, uuid, jsonb, text), public.cancel_registration(uuid),
  public.check_in(uuid), public.mark_paid_at_course(uuid, boolean), public.save_event_score(uuid, jsonb, integer, integer, integer, integer),
  public.award_event_points(uuid), public.finalize_event(uuid), public.my_roles(), public.join_community(uuid),
  public.org_dashboard(uuid, date, date), public.season_standings(uuid) TO authenticated;
-- Public event page and TV leaderboard work without signing in (published public/unlisted events only)
GRANT EXECUTE ON FUNCTION public.public_event(uuid), public.event_leaderboard(uuid) TO anon, authenticated;

-- =====================================================================
-- Realtime: live leaderboards, check-ins, notifications
-- =====================================================================
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['event_results', 'registrations', 'notification_outbox'] LOOP
    BEGIN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- =====================================================================
-- Seed: the app's 86 KC-area courses (same ids as src/data/courses.json)
-- =====================================================================
INSERT INTO public.courses (id, name, city, state, address, latitude, longitude, par, course_type) VALUES
  ('f537e738-2369-4cec-9e5f-6c56cc5383dc', 'Harris Park Golf Course', 'Kansas City', 'MO', '4029 Wayne Ave, Kansas City, MO 64110, USA', 39.0529997, -94.5650529, NULL, 'Public'),
  ('6282c875-4fb2-4a49-9eb4-adf95981ed3d', 'Mission Hills Country Club', 'Mission Hills', 'KS', '5400 Mission Dr, Mission Hills, KS 66208, USA', 39.0291144, -94.6146104, 70, 'Private'),
  ('a658026f-c67c-424c-85d1-8f4ac155c4c4', 'Kansas City Country Club', 'Mission Hills', 'KS', '6200 Indian Ln #1203, Mission Hills, KS 66208, USA', 39.0214131, -94.6217341, 70, 'Private'),
  ('efbfd915-85cb-46f5-8360-68ad23ddd41f', 'Indian Hills Country Club', 'Mission Hills', 'KS', '6847 Tomahawk Rd, Mission Hills, KS 66208, USA', 39.0047737, -94.6276273, 70, 'Private'),
  ('ef42e2ef-a1f5-4683-a36e-a25ace2ed5fa', 'Swope Memorial Golf Course', 'Kansas City', 'MO', '6900 Swope Memorial Dr, Kansas City, MO 64132, USA', 39.0016441, -94.5165252, 72, 'Public'),
  ('0a64f7f0-1c8c-4bbd-956a-6cce84ce90d4', 'Meadows Golf Club', 'Kansas City', 'MO', '10501 E 47th St, Kansas City, MO 64133, USA', 39.0366173, -94.4558812, 70, 'Public'),
  ('bedb7403-de79-443b-a52e-29c3ab9a57fb', 'Heart Of America Golf Academy River Course', 'Kansas City', 'MO', '7501 Blue River Rd, Kansas City, MO 64132, USA', 38.9874079, -94.5267218, 35, 'Public'),
  ('8b4ed254-b1f6-4c8b-aaed-cbdf27cb2e8d', 'Heart Of America Golf Academy Rock Course', 'Kansas City', 'MO', '7501 Blue River Rd, Kansas City, MO 64132, USA', 38.9874079, -94.5267218, 27, 'Public'),
  ('c7d78516-22ef-4d45-81f4-4712d9367d0d', 'Milburn Country Club', 'Overland Park', 'KS', '7501 W 69th St, Overland Park, KS 66204, USA', 39.0038904, -94.6730704, 72, 'Private'),
  ('cc492652-50c7-47e1-a4e3-549f13baa64c', 'Cheyenne Hills Golf Course', 'Kansas City', 'KS', '7101 Parallel Pkwy, Kansas City, KS 66112, USA', 39.1277778, -94.7430556, 36, 'Public'),
  ('989d9c09-09c2-48ba-9bff-27b3f6adefe7', 'Painted Hills Golf Club', 'Kansas City', 'KS', '7101 Parallel Pkwy, Kansas City, KS 66112, USA', 39.1277778, -94.7430556, 70, 'Public'),
  ('3446b181-649f-441b-9ce6-2e97abca52e3', 'The Bluffs At The National Golf Club Of Kansas City', 'Parkville', 'MO', '6415 N National Dr, Parkville, MO 64152, USA', 39.2120416, -94.7013459, 70, 'Private'),
  ('4b5c59d3-9b3a-4a89-b771-310093d2b142', 'Oakwood Country Club', 'Kansas City', 'MO', '9800 Grandview Rd, Kansas City, MO 64137, USA', 38.9480862, -94.5530079, 72, 'Private'),
  ('2037e9ac-8e58-4125-ad2f-c947e7df4039', 'Oakwood Country Club Par 3 Course', 'Kansas City', 'MO', '9800 Grandview Rd, Kansas City, MO 64137, USA', 38.9480862, -94.5530079, 27, 'Private'),
  ('d61fdd7f-e2df-42d0-af93-538a962ae678', 'National Golf Club Of Kansas City', 'Parkville', 'MO', '6700 N National Dr, Parkville, MO 64152, USA', 39.2187814, -94.7120491, 72, 'Private'),
  ('e196f49e-8706-4139-acb0-b15a45f0fcf5', 'Lake Quivira Country Club', 'Lake Quivira', 'KS', '100 Crescent Blvd, Lake Quivira, KS 66217, USA', 39.0467382, -94.7711614, 71, 'Private/Resort'),
  ('c2557839-425a-5e12-ace8-531867297105', 'Hodge Park Golf Club', 'Kansas City', 'MO', '7000 NE Barry Rd', 39.2547, -94.4994, 70, 'Public'),
  ('2bcadc69-0b58-4bb9-bfef-db1a212efea2', 'Teetering Rocks Executive Links', 'Kansas City', 'MO', 'Crysler Drive', 38.965264, -94.440537, 66, 'Public'),
  ('5a745354-3991-4388-b154-a637aff25d1f', 'Hallbrook Country Club', 'Leawood', 'KS', '11200 Overbrook Rd, Leawood, KS 66211, USA', 38.9244197, -94.6110734, 72, 'Private'),
  ('46e581e7-9fed-47c6-9e0a-a583bedd51af', 'Minor Park Golf Course', 'Kansas City', 'MO', '11215 Holmes Rd, Kansas City, MO 64131, USA', 38.9226177, -94.5827608, 70, 'Public/Municipal'),
  ('9ed170a3-3398-5018-8c73-28512588c2e2', 'Shoal Creek Golf Course', 'Kansas City', 'MO', '8905 N Shoal Creek Pkwy', 39.263, -94.4944, 71, 'Public'),
  ('122447ae-6adb-499f-94ef-a2b7f1d6e30b', 'Brookridge Golf Fitness West Nine', 'Overland Park', 'KS', '8223 103rd St, Overland Park, KS 66212, USA', 38.9384386, -94.6818404, 36, 'Private'),
  ('95dd1b65-cfd8-4512-bc77-5f9b3ddee76a', 'Brookridge Golf Fitness Championship Course', 'Overland Park', 'KS', '8223 103rd St, Overland Park, KS 66212, USA', 38.9384386, -94.6818404, 70, 'Private'),
  ('e8a36281-7eb1-4c8f-b98a-694876b9ad7c', 'Tiffany Greens Golf Club', 'Kansas City', 'MO', '5900 NW Tiffany Springs Pkwy, Kansas City, MO 64154, USA', 39.2742721, -94.6459609, 72, 'Semi-Private'),
  ('622c0fd6-856c-41c7-8c10-e0d1f6a5aec7', 'Tomahawk Hills Golf Course', 'Shawnee', 'KS', '17501 Midland Dr, Shawnee, KS 66217, USA', 38.9997405, -94.7908587, 70, 'Public/Municipal'),
  ('bd8d04a3-82ea-4c9b-86e2-683319aaaad8', 'Blue Hills Country Club', 'Kansas City', 'MO', '777 W Burning Tree Dr, Kansas City, MO 64145, USA', 38.8991643, -94.6020129, 72, 'Private'),
  ('f529fc39-7663-4f05-8447-7e9ca0c91ff2', 'Country Club Of Leawood', 'Leawood', 'KS', '12700 Overbrook Rd, Leawood, KS 66209, USA', 38.8970475, -94.6163675, 71, 'Private'),
  ('1170b427-681b-4138-af10-471e5efb5f32', 'Lake Of The Forest Golf Course', 'Bonner Springs', 'KS', '100 Lake Of The Forest, Bonner Springs, KS 66012, USA', 39.0658782, -94.8390735, NULL, 'Private'),
  ('987b51b9-023e-4ab8-af11-4acfe39737e8', 'Canyon Farms Golf Club', 'Lenexa', 'KS', '17501 W 87th St Pkwy, Lenexa, KS 66219, USA', 38.9694811, -94.7943405, 71, 'Semi-Private'),
  ('1d9654d9-0185-4400-953e-e397029da3e9', 'Sunflower Hills Golf Course', 'Bonner Springs', 'KS', '12200 Riverview Ave, Bonner Springs, KS 66012, USA', 39.1036132, -94.8603399, 72, 'Public'),
  ('d9649687-435a-4cf6-86d2-2415fc181e6b', 'Deer Creek Golf Club', 'Overland Park', 'KS', '7000 W 133rd St, Overland Park, KS 66209, USA', 38.8887289, -94.6662324, 72, 'Semi-Private'),
  ('fa0448f6-6b60-429c-aa97-12b8546a502e', 'Sykes Lady Overland Park Golf Club West North Course', 'Overland Park', 'KS', '12501 Quivira Rd, Overland Park, KS 66213, USA', 38.9017669, -94.7222016, 70, 'Public/Municipal'),
  ('2ec888c8-f5b9-4983-b722-e97779d012bf', 'Sykes Lady Overland Park Golf Club Par 3 Course', 'Overland Park', 'KS', '12501 Quivira Rd, Overland Park, KS 66213, USA', 38.9017669, -94.7222016, 27, 'Public/Municipal'),
  ('d7a625ff-803b-496c-8707-25710462edba', 'Sykes Lady Overland Park Golf Club South West Course', 'Overland Park', 'KS', '12501 Quivira Rd, Overland Park, KS 66213, USA', 38.9017669, -94.7222016, 70, 'Public/Municipal'),
  ('36990d72-7890-4214-957c-0f02886acf7d', 'Sykes Lady Overland Park Golf Club North South Course', 'Overland Park', 'KS', '12501 Quivira Rd, Overland Park, KS 66213, USA', 38.9017669, -94.7222016, 70, 'Public/Municipal'),
  ('ce407a0c-948b-470c-bc2a-8b685b88c44a', 'Falcon Valley Golf Course', 'Lenexa', 'KS', '9801 Falcon Valley Dr, Lenexa, KS 66220, USA', 38.9523982, -94.8092478, 36, 'Public'),
  ('e5193f24-99ab-4b8e-be70-bdd37ab05fe2', 'Shawnee Golf Country Club Heartland Hills Course', 'Shawnee', 'KS', '6404 Hedge Ln Terrace, Shawnee, KS 66226, USA', 39.0121095, -94.8564795, 36, 'Semi-Private'),
  ('252b983c-cfb7-4f1e-98e4-7cd1dd2b177e', 'Shawnee Golf Country Club Clear Creek Course', 'Shawnee', 'KS', '6404 Hedge Ln Terrace, Shawnee, KS 66226, USA', 39.0121095, -94.8564795, 36, 'Semi-Private'),
  ('a8fa1ea8-5181-4129-9e90-52eac145e2ad', 'Shawnee Country Club', 'Shawnee', 'KS', '6404 Hedge Ln Terrace, Shawnee, KS 66226, USA', 39.0121095, -94.8564795, 71, 'Private'),
  ('ba39f8f3-0ba6-4541-8e10-8f77354f58ec', 'Shawnee Golf Country Club Chapel Creek Course', 'Shawnee', 'KS', '6404 Hedge Ln Terrace, Shawnee, KS 66226, USA', 39.0121095, -94.8564795, 36, 'Semi-Private'),
  ('a9bbf3ab-35c9-4f13-9559-761754977176', 'Nicklaus Golf Club At Lionsgate', 'Overland Park', 'KS', '14225 Dearborn St, Overland Park, KS 66223, USA', 38.8702094, -94.6575889, 72, 'Private'),
  ('5c91eabf-ec11-4ab1-9c17-eff44a7643fd', 'Falcon Ridge Golf Course', 'Lenexa', 'KS', '20200 Prairie Star Pkwy, Lenexa, KS 66220, USA', 38.9516195, -94.8207483, 72, 'Private'),
  ('502ae265-f77b-45c5-a57e-c52efeb7783d', 'Yucca Ridge Golf Club', 'Lenexa', 'KS', '20200 Prairie Star Pkwy, Lenexa, KS 66220, USA', 38.9516195, -94.8207483, NULL, 'Public'),
  ('e71b8ed6-ab04-42e2-b94f-e7e1ef76c301', 'St Andrews Golf Club', 'Overland Park', 'KS', '11099 W 135th St, Overland Park, KS 66221, USA', 38.8828591, -94.7133949, 71, 'Public/Municipal'),
  ('4f70615f-41f5-446e-aae2-2e6354ca9b86', 'Dubs Dread Golf Club', 'Kansas City', 'KS', '12601 Hollingsworth Rd, Kansas City, KS 66109, USA', 39.171835, -94.876137, 72, 'Public'),
  ('6c187016-df50-4cc9-9a01-eb000e0eac0a', 'Ironhorse Golf Club', 'Leawood', 'KS', '15400 Mission Rd, Leawood, KS 66224, USA', 38.8499546, -94.6341492, 72, 'Public'),
  ('6f1dc079-10cb-4b6f-9f49-4fb7306c076e', 'Smileys Executive Golf Club', 'Lenexa', 'KS', '10195 Monticello Terrace, Lenexa, KS 66227, USA', 38.9440879, -94.8505554, 60, 'Public'),
  ('98bb1ec2-b773-4de1-ae2b-6755e464da2e', 'Falcon Lakes Golf Course', 'Basehor', 'KS', '4605 Clubhouse Dr #19, Basehor, KS 66007, USA', 39.1675542, -94.9075539, 72, 'Public'),
  ('18296719-463e-445f-860d-6188b63ec529', 'Eagles Landing Golf Course Of Belton', 'Belton', 'MO', '4200 Bong Ave, Belton, MO 64012, USA', 38.8337546, -94.5484899, 72, 'Public'),
  ('50e28862-6c13-4233-a1c3-86b32c5614b8', 'Loch Lloyd Country Club Sechrest Nine', 'Village of Loch Lloyd', 'MO', '16750 Country Club Dr, Village of Loch Lloyd, MO 64012, USA', 38.828762, -94.5895065, NULL, 'Private/Resort'),
  ('9368302f-0a6b-4bc8-847f-ac33b605ba5a', 'Loch Lloyd Country Club', 'Village of Loch Lloyd', 'MO', '16750 Country Club Dr, Village of Loch Lloyd, MO 64012, USA', 38.828762, -94.5895065, 72, 'Private/Resort'),
  ('f08ce2aa-7f48-4313-a1fa-d86cc1b03dde', 'Adams Golf Club', 'Blue Springs', 'MO', '1601 NE R D Mize Rd, Blue Springs, MO 64014, USA', 39.0236919, -94.240746, 72, 'Public/Municipal'),
  ('da3225b6-ba71-4076-be22-8c1fa8843919', 'Shiloh Springs Golf Club', 'Platte City', 'MO', '14750 Fairway Ln, Platte City, MO 64079, USA', 39.3603935, -94.7304306, 71, 'Public'),
  ('dce31c00-7fa3-4ae3-b02c-e8b2f4e12f03', 'Shadow Glen The Golf Club', 'Olathe', 'KS', '26000 Shadow Glen St, Olathe, KS 66061, USA', 38.9384016, -94.8881767, 72, 'Private'),
  ('94a081fb-bedb-4f88-8077-f08256cbee96', 'Heritage Park Golf Course', 'Olathe', 'KS', '16447 Constance St, Olathe, KS 66062, USA', 38.830001, -94.7581533, 71, 'Public/Municipal'),
  ('dc980df2-9b2f-4dc4-aa91-b27241b1d45e', 'Leavenworth Golf Club', 'Lansing', 'KS', '455 W Eisenhower Rd, Lansing, KS 66043, USA', 39.2656936, -94.9084854, 70, 'Private'),
  ('80484d1b-8f46-47dc-9ebc-146e144631f8', 'Burning Tree Golf Club', 'De Soto', 'KS', '7909 E Wyandotte St, De Soto, KS 66018, USA', 38.9841558, -94.9598143, 35, 'Public'),
  ('9df71e30-01fe-40e8-a1ff-9401f2d9cb37', 'Mari Mac Golf Complex', 'Kearney', 'MO', '525 South Marimack Drive', 39.3680619147, -94.3495720929, 54, 'Public'),
  ('1270f167-d66b-4c59-9d39-b9da7836f97d', 'Posse At Paradise Pointe Golf Complex', 'Smithville', 'MO', 'Golf Course Road', 39.4203644574, -94.5450699629, 72, 'Public'),
  ('e3b1274f-b8a4-4c25-8f48-d6ecfdd7fa97', 'Oak Country Club', 'De Soto', 'KS', '8800 Scott Dr, De Soto, KS 66018, USA', 38.9697647, -94.9621887, 66, 'Public'),
  ('71fce901-6976-4814-8c3d-443f3fd6d627', 'St Marys Public Golf Course', 'De Soto', 'KS', '8800 Scott Dr, De Soto, KS 66018, USA', 38.9697647, -94.9621887, 34, 'Public'),
  ('081a5bb6-0ee2-488a-b05b-af4a926de693', 'Outlaw At Paradise Pointe Golf Complex', 'Smithville', 'MO', 'Northeast 188th Street', 39.431801112, -94.5442974867, 72, 'Public'),
  ('18046706-5165-4002-b153-56f30fe20d56', 'Prairie Highlands Golf Course', 'Olathe', 'KS', '14695 S Inverness St, Olathe, KS 66061, USA', 38.8617337, -94.8857398, 72, 'Public'),
  ('c12c0637-6294-4f10-9210-7ec40ae95042', 'Wolf Creek Golf Club', 'Olathe', 'KS', '18695 S Lackman Rd, Olathe, KS 66062, USA', 38.7902687, -94.7560073, 72, 'Private'),
  ('835c8b00-a6cf-4873-8aed-1d59f2e76c03', 'Trails West Golf Course', 'Fort Leavenworth', 'KS', '306 Cody Rd, Fort Leavenworth, KS 66027, USA', 39.3447287, -94.9227857, 71, 'Military'),
  ('ccc83465-ad81-4269-9c36-74cf7f21ea4b', 'Gardner Golf Course', 'Gardner', 'KS', '15810 S Gardner Rd, Gardner, KS 66030, USA', 38.8412319, -94.9277799, NULL, 'Public'),
  ('81f3a574-54e2-42ab-8ebe-8e2ad52cc41f', 'Sycamore Valley Golf Course', 'Spring Hill', 'KS', '21731 Clubhouse Dr, Spring Hill, KS 66083, USA', 38.7583389, -94.8376388, 71, 'Public'),
  ('97e137ae-7e9f-4fe4-ab96-6b66e0ad5ee6', 'Sycamore Ridge', 'Spring Hill', 'KS', '21731 Clubhouse Dr, Spring Hill, KS 66083, USA', 38.7583389, -94.8376388, 72, 'Public'),
  ('d03e43a5-3617-4943-83ec-c20ac9a1adf5', 'Harrisonville Golf Club', 'Harrisonville', 'MO', '706 Sandy Links Ln, Harrisonville, MO 64701, USA', 38.6685584, -94.3302119, 35, 'Municipal'),
  ('93e48e25-5d86-4066-94e1-7ca0368e4131', 'Lawrence Country Club', 'Lawrence', 'KS', '400 Country Club Terrace, Lawrence, KS 66049, USA', 38.9768698, -95.26365, 70, 'Private'),
  ('ee797bd8-e3df-44fd-9697-3d8098258888', 'Paola Country Club', 'Paola', 'KS', '29651 Old Kansas City Rd, Paola, KS 66071, USA', 38.5906983, -94.8669738, 36, 'Private'),
  ('c1f79354-c59c-408a-b2b5-b1843ad27513', 'Orchards Executive Golf Course', 'Lawrence', 'KS', '3000 Bob Billings Pkwy, Lawrence, KS 66049, USA', 38.9572649, -95.2724544, 31, 'Public'),
  ('d9620d39-13eb-4013-ba6a-9cf9e35355b5', 'Alvamar Golf Club Members Course', 'Lawrence', 'KS', '1809 Crossgate Dr, Lawrence, KS 66047, USA', 38.951075, -95.29199, 71, 'Private'),
  ('608f30b6-7f7f-4e74-9f67-4cbbc7916e1e', 'The Jayhawk Club', 'Lawrence', 'KS', '1809 Birdie Wy, Lawrence, KS 66047, USA', 38.9511238, -95.2920379, 72, 'Private'),
  ('5a5d9263-38cc-4138-b962-51f84adeb3d9', 'Baldwin Golf Association', 'Baldwin City', 'KS', '1102 Main St, Baldwin City, KS 66006, USA', 38.7718566, -95.200031, NULL, 'Semi-Private'),
  ('8478adda-8196-4da7-8f1d-c92688143c80', 'The Links At Kansas Golf Club', 'Lawrence', 'KS', '5401 Rock Chalk Dr, Lawrence, KS 66049, USA', 38.9803122, -95.3184919, NULL, 'Semi-Private'),
  ('c0b97f70-084d-47e6-95ab-5de52cb947a8', 'Eagle Bend Golf Course', 'Lawrence', 'KS', '1250 E 902 Rd, Lawrence, KS 66049, USA', 38.9217101, -95.3261296, 72, 'Public'),
  ('99037323-704c-4984-ad25-2fff09fbd4ec', 'Kira S Kingdom Golf Course', 'Archie', 'MO', '14209 State Rte A, Archie, MO 64725, USA', 38.4877358, -94.439698, NULL, 'Public'),
  ('4bb7a9c9-fe69-4eb2-be07-a8dac52411d3', 'Copper Hill Golf Club', 'St Joseph', 'MO', '6480 SE, SE U.S. Hwy 169, St Joseph, MO 64507, USA', 39.7096061, -94.7506484, 29, 'Public'),
  ('33a3c069-08f2-4fa7-a59d-ed78e877ce34', 'Pineview Country Club', 'Atchison', 'KS', '5882 Ottawa Rd, Atchison, KS 66002, USA', 39.5238622, -95.1799867, 35, 'Semi-Private'),
  ('46d029fc-132a-45b0-ae78-2a1eebcc07d0', 'Atchison Golf Club At Bellevue', 'Atchison', 'KS', '1713 Country Club Rd, Atchison, KS 66002, USA', 39.5743931, -95.147474, 71, 'Semi-Private'),
  ('81bc8d5e-4468-436a-bcf9-c3a1ae31f2ab', 'Osawatomie Golf Course', 'Osawatomie', 'KS', '32942 W Lakeside Dr, Osawatomie, KS 66064, USA', 38.5309789, -94.9936509, 71, 'Public/Municipal'),
  ('b356be82-909b-42b8-aebb-a21c2a596691', 'Fairview Golf Course', 'St Joseph', 'MO', '3302 Pacific St, St Joseph, MO 64507, USA', 39.7467881, -94.8144168, 72, 'Public/Municipal'),
  ('2c78eb22-ed69-4b4d-b16f-6237eea333bd', 'Lake Perry Country Club', 'Ozawkie', 'KS', '6506 Cherokee Ln, Ozawkie, KS 66070, USA', 39.164935, -95.471576, 69, 'Private'),
  ('928d7f26-bf03-4017-bb44-9c0a0360e38a', 'Moila Country Club', 'St Joseph', 'MO', '701 N Noyes Blvd, St Joseph, MO 64506, USA', 39.7727966, -94.8237838, 71, 'Private'),
  ('6cecbdff-b993-481f-9426-3d802a0cd88c', 'Ottawa Golf Course', 'Ottawa', 'KS', '1001 E Logan St, Ottawa, KS 66067, USA', 38.6246118, -95.2554684, 35, 'Public')
ON CONFLICT (id) DO NOTHING;
