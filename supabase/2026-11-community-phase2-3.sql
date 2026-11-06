-- =====================================================================
-- ForeSome — Community Layer Phase 2 & Phase 3
-- Phase 2: Stripe Connect Payments, Add-ons, Refunds & Reconciliation,
--          Sponsorship Packages (Event & Season), Charity Donations & Goals
-- Phase 3: Branded Communities (/c/:slug), Membership Tiers & Recurring Dues,
--          CSV Member Import, Pro Shop & On-Course Concessions Queue,
--          Announcements (Email/SMS/Push), Board/Polls/Photos/Event Chat,
--          Calendar View & Event Attendance Sheet
-- Run AFTER 2026-11-community-phase1.sql. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2.1 PAYMENTS & STRIPE CONNECT SCHEMA
-- ---------------------------------------------------------------------
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#b89a5c',
  ADD COLUMN IF NOT EXISTS banner_text text,
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payout_schedule text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS platform_fee_bps integer NOT NULL DEFAULT 250;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payout_schedule text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS platform_fee_bps integer NOT NULL DEFAULT 250;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS saved_pm_id text,
  ADD COLUMN IF NOT EXISTS saved_pm_brand text,
  ADD COLUMN IF NOT EXISTS saved_pm_last4 text;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS pass_processing_fee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_donations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fundraising_goal_cents integer CHECK (fundraising_goal_cents IS NULL OR fundraising_goal_cents >= 0),
  ADD COLUMN IF NOT EXISTS donation_title text;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS addons_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS donation_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS attendance_status text CHECK (attendance_status IS NULL OR attendance_status IN ('present', 'late', 'left_early', 'absent')),
  ADD COLUMN IF NOT EXISTS attendance_notes text;

-- Event Add-ons (mulligans, range balls, box lunch, skins pot, etc.)
CREATE TABLE IF NOT EXISTS public.event_addons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  price_cents    integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  max_per_player integer NOT NULL DEFAULT 4 CHECK (max_per_player >= 1),
  stock_count    integer CHECK (stock_count IS NULL OR stock_count >= 0),
  sold_count     integer NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_addons_event_idx ON public.event_addons (event_id);

-- Unified Stripe Connect Payments Ledger
CREATE TABLE IF NOT EXISTS public.payments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  community_id             uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  organization_id          uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_id                 uuid REFERENCES public.events(id) ON DELETE SET NULL,
  registration_id          uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  kind                     text NOT NULL CHECK (kind IN ('event_entry', 'sponsorship', 'donation', 'dues', 'shop_order')),
  subtotal_cents           integer NOT NULL DEFAULT 0,
  processing_fee_cents     integer NOT NULL DEFAULT 0,
  platform_fee_cents       integer NOT NULL DEFAULT 0,
  total_cents              integer NOT NULL DEFAULT 0,
  net_organizer_cents      integer NOT NULL DEFAULT 0,
  refunded_cents           integer NOT NULL DEFAULT 0,
  fee_absorbed_by_admin    boolean NOT NULL DEFAULT true,
  payment_method           text NOT NULL DEFAULT 'card', -- 'card' | 'apple_pay' | 'google_pay' | 'saved_card' | 'course'
  card_last4               text,
  stripe_payment_intent_id text,
  stripe_destination_acct  text,
  status                   text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending', 'succeeded', 'partially_refunded', 'refunded', 'failed')),
  line_items               jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  refunded_at              timestamptz
);
CREATE INDEX IF NOT EXISTS payments_event_idx     ON public.payments (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_community_idx ON public.payments (community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_org_idx       ON public.payments (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_profile_idx   ON public.payments (profile_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 2.2 SPONSORSHIPS (EVENT & SEASON-LONG PACKAGES)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sponsor_packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid REFERENCES public.events(id) ON DELETE CASCADE,
  season_id    uuid REFERENCES public.seasons(id) ON DELETE CASCADE,
  community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  quantity     integer CHECK (quantity IS NULL OR quantity > 0),
  sold_count   integer NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  benefits     jsonb NOT NULL DEFAULT '["hole_sign","tv_logo","cart_sign","shout_out"]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(event_id, season_id) >= 1)
);
CREATE INDEX IF NOT EXISTS sponsor_packages_event_idx  ON public.sponsor_packages (event_id);
CREATE INDEX IF NOT EXISTS sponsor_packages_season_idx ON public.sponsor_packages (season_id);

CREATE TABLE IF NOT EXISTS public.sponsorships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        uuid NOT NULL REFERENCES public.sponsor_packages(id) ON DELETE CASCADE,
  event_id          uuid REFERENCES public.events(id) ON DELETE CASCADE,
  season_id         uuid REFERENCES public.seasons(id) ON DELETE CASCADE,
  community_id      uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  sponsor_name      text NOT NULL,
  logo_url          text,
  website_url       text,
  hole_number       integer CHECK (hole_number IS NULL OR hole_number BETWEEN 1 AND 18),
  shout_out_text    text,
  contact_email     text,
  benefits          jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_paid_cents integer NOT NULL DEFAULT 0,
  payment_id        uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'refunded')),
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sponsorships_event_idx  ON public.sponsorships (event_id);
CREATE INDEX IF NOT EXISTS sponsorships_season_idx ON public.sponsorships (season_id);

-- ---------------------------------------------------------------------
-- 2.3 DONATIONS & FUNDRAISING
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_donations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  donor_name   text NOT NULL DEFAULT 'Anonymous Golfer',
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  message      text,
  is_anonymous boolean NOT NULL DEFAULT false,
  payment_id   uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_donations_event_idx ON public.event_donations (event_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 3.2 MEMBERSHIP TIERS & RECURRING DUES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id     uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  name             text NOT NULL, -- e.g. 'Full Member', 'Social', 'Junior'
  description      text,
  price_cents      integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  billing_interval text NOT NULL DEFAULT 'annual' CHECK (billing_interval IN ('annual', 'monthly', 'season')),
  member_discount_pct integer NOT NULL DEFAULT 0 CHECK (member_discount_pct BETWEEN 0 AND 100),
  benefits         jsonb NOT NULL DEFAULT '[]'::jsonb,
  stripe_price_id  text,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_tiers_community_idx ON public.membership_tiers (community_id, sort_order);

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS tier_id uuid REFERENCES public.membership_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'active' CHECK (payment_status IN ('active', 'past_due', 'retrying', 'cancelled')),
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS imported_email text,
  ADD COLUMN IF NOT EXISTS imported_name text;

-- ---------------------------------------------------------------------
-- 3.3 PRO SHOP & CONCESSIONS (MERCH, CONCESSIONS, ON-COURSE ORDERING)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shop_products (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id       uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id          uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  category           text NOT NULL DEFAULT 'concessions' CHECK (category IN ('merch', 'concessions', 'addon')),
  name               text NOT NULL,
  description        text,
  image_url          text,
  price_cents        integer NOT NULL CHECK (price_cents >= 0),
  member_price_cents integer CHECK (member_price_cents IS NULL OR member_price_cents >= 0),
  stock_count        integer NOT NULL DEFAULT 50 CHECK (stock_count >= 0),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_products_community_idx ON public.shop_products (community_id);
CREATE INDEX IF NOT EXISTS shop_products_org_idx       ON public.shop_products (organization_id);

CREATE TABLE IF NOT EXISTS public.shop_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_id    uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id       uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  event_id        uuid REFERENCES public.events(id) ON DELETE SET NULL,
  channel         text NOT NULL DEFAULT 'on_course' CHECK (channel IN ('online', 'event_day', 'on_course')),
  fulfillment     text NOT NULL DEFAULT 'turn_pickup' CHECK (fulfillment IN ('turn_pickup', 'cart_delivery', 'pro_shop')),
  hole_number     integer CHECK (hole_number IS NULL OR hole_number BETWEEN 1 AND 18),
  cart_number     text,
  items           jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{product_id, name, qty, unit_cents}]
  total_cents     integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'preparing', 'ready', 'delivered', 'cancelled')),
  payment_id      uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_orders_org_status_idx       ON public.shop_orders (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_community_status_idx ON public.shop_orders (community_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_profile_idx          ON public.shop_orders (profile_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 3.4 MESSAGING, ANNOUNCEMENTS, BOARD, POLLS, PHOTOS & EVENT CHAT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_announcements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  event_id      uuid REFERENCES public.events(id) ON DELETE CASCADE,
  title         text NOT NULL,
  body          text NOT NULL,
  channels      jsonb NOT NULL DEFAULT '["email","sms","push"]'::jsonb,
  scheduled_for timestamptz,
  sent_at       timestamptz,
  recipient_cnt integer NOT NULL DEFAULT 0,
  created_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_announcements_comm_idx ON public.community_announcements (community_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  event_id      uuid REFERENCES public.events(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'poll', 'photo', 'chat')),
  body          text,
  media_urls    jsonb NOT NULL DEFAULT '[]'::jsonb,
  poll_question text,
  poll_options  jsonb NOT NULL DEFAULT '[]'::jsonb, -- ["Sunday 8am", "Sunday 10am"]
  scheduled_for timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_posts_comm_idx  ON public.community_posts (community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_posts_event_idx ON public.community_posts (event_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.community_poll_votes (
  post_id      uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  option_index integer NOT NULL CHECK (option_index >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, profile_id)
);

-- =====================================================================
-- ROW LEVEL SECURITY POLICIES (PHASE 2 & 3 TABLES)
-- =====================================================================
ALTER TABLE public.event_addons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_packages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsorships            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_donations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_poll_votes    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_addons_read"  ON public.event_addons;
DROP POLICY IF EXISTS "event_addons_write" ON public.event_addons;
CREATE POLICY "event_addons_read"  ON public.event_addons FOR SELECT USING (true);
CREATE POLICY "event_addons_write" ON public.event_addons FOR ALL
  USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));

DROP POLICY IF EXISTS "payments_read"  ON public.payments;
DROP POLICY IF EXISTS "payments_write" ON public.payments;
CREATE POLICY "payments_read" ON public.payments FOR SELECT
  USING (profile_id = auth.uid()
         OR (event_id IS NOT NULL AND public.can_manage_event(event_id))
         OR (community_id IS NOT NULL AND public.is_community_admin(community_id))
         OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id))
         OR public.is_platform_admin());
CREATE POLICY "payments_write" ON public.payments FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "sponsor_packages_read"  ON public.sponsor_packages;
DROP POLICY IF EXISTS "sponsor_packages_write" ON public.sponsor_packages;
CREATE POLICY "sponsor_packages_read"  ON public.sponsor_packages FOR SELECT USING (true);
CREATE POLICY "sponsor_packages_write" ON public.sponsor_packages FOR ALL
  USING ((event_id IS NOT NULL AND public.can_manage_event(event_id))
         OR (community_id IS NOT NULL AND public.is_community_admin(community_id))
         OR public.is_platform_admin())
  WITH CHECK ((event_id IS NOT NULL AND public.can_manage_event(event_id))
              OR (community_id IS NOT NULL AND public.is_community_admin(community_id))
              OR public.is_platform_admin());

DROP POLICY IF EXISTS "sponsorships_read"  ON public.sponsorships;
DROP POLICY IF EXISTS "sponsorships_write" ON public.sponsorships;
CREATE POLICY "sponsorships_read"  ON public.sponsorships FOR SELECT USING (true);
CREATE POLICY "sponsorships_write" ON public.sponsorships FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "event_donations_read"  ON public.event_donations;
DROP POLICY IF EXISTS "event_donations_write" ON public.event_donations;
CREATE POLICY "event_donations_read"  ON public.event_donations FOR SELECT USING (true);
CREATE POLICY "event_donations_write" ON public.event_donations FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "membership_tiers_read"  ON public.membership_tiers;
DROP POLICY IF EXISTS "membership_tiers_write" ON public.membership_tiers;
CREATE POLICY "membership_tiers_read"  ON public.membership_tiers FOR SELECT USING (true);
CREATE POLICY "membership_tiers_write" ON public.membership_tiers FOR ALL
  USING (public.is_community_admin(community_id)) WITH CHECK (public.is_community_admin(community_id));

DROP POLICY IF EXISTS "shop_products_read"  ON public.shop_products;
DROP POLICY IF EXISTS "shop_products_write" ON public.shop_products;
CREATE POLICY "shop_products_read"  ON public.shop_products FOR SELECT USING (true);
CREATE POLICY "shop_products_write" ON public.shop_products FOR ALL
  USING ((community_id IS NOT NULL AND public.is_community_admin(community_id))
         OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id))
         OR public.is_platform_admin())
  WITH CHECK ((community_id IS NOT NULL AND public.is_community_admin(community_id))
              OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id))
              OR public.is_platform_admin());

DROP POLICY IF EXISTS "shop_orders_read"   ON public.shop_orders;
DROP POLICY IF EXISTS "shop_orders_insert" ON public.shop_orders;
DROP POLICY IF EXISTS "shop_orders_update" ON public.shop_orders;
CREATE POLICY "shop_orders_read" ON public.shop_orders FOR SELECT
  USING (profile_id = auth.uid()
         OR (community_id IS NOT NULL AND public.is_community_admin(community_id))
         OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id))
         OR (event_id IS NOT NULL AND public.can_manage_event(event_id))
         OR public.is_platform_admin());
CREATE POLICY "shop_orders_insert" ON public.shop_orders FOR INSERT
  WITH CHECK (profile_id = auth.uid());
CREATE POLICY "shop_orders_update" ON public.shop_orders FOR UPDATE
  USING (profile_id = auth.uid()
         OR (community_id IS NOT NULL AND public.is_community_admin(community_id))
         OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id))
         OR (event_id IS NOT NULL AND public.can_manage_event(event_id))
         OR public.is_platform_admin());

DROP POLICY IF EXISTS "announcements_read"  ON public.community_announcements;
DROP POLICY IF EXISTS "announcements_write" ON public.community_announcements;
CREATE POLICY "announcements_read"  ON public.community_announcements FOR SELECT USING (true);
CREATE POLICY "announcements_write" ON public.community_announcements FOR ALL
  USING ((community_id IS NOT NULL AND public.is_community_admin(community_id))
         OR (event_id IS NOT NULL AND public.can_manage_event(event_id)))
  WITH CHECK ((community_id IS NOT NULL AND public.is_community_admin(community_id))
              OR (event_id IS NOT NULL AND public.can_manage_event(event_id)));

DROP POLICY IF EXISTS "community_posts_read"   ON public.community_posts;
DROP POLICY IF EXISTS "community_posts_insert" ON public.community_posts;
DROP POLICY IF EXISTS "community_posts_delete" ON public.community_posts;
CREATE POLICY "community_posts_read"   ON public.community_posts FOR SELECT USING (true);
CREATE POLICY "community_posts_insert" ON public.community_posts FOR INSERT WITH CHECK (author_id = auth.uid());
CREATE POLICY "community_posts_delete" ON public.community_posts FOR DELETE
  USING (author_id = auth.uid()
         OR (community_id IS NOT NULL AND public.is_community_admin(community_id))
         OR (event_id IS NOT NULL AND public.can_manage_event(event_id)));

DROP POLICY IF EXISTS "poll_votes_read"  ON public.community_poll_votes;
DROP POLICY IF EXISTS "poll_votes_write" ON public.community_poll_votes;
CREATE POLICY "poll_votes_read"  ON public.community_poll_votes FOR SELECT USING (true);
CREATE POLICY "poll_votes_write" ON public.community_poll_votes FOR ALL
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- =====================================================================
-- PHASE 2 & 3 RPC FUNCTIONS
-- =====================================================================

-- 1. Enhanced public_event: includes add-ons, sponsor packages, active sponsors
--    (both event-level and season-long), and fundraising progress!
CREATE OR REPLACE FUNCTION public.public_event(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'event', to_jsonb(ev) - 'teequest_ref',
    'course', jsonb_build_object('id', co.id, 'name', co.name, 'city', co.city, 'state', co.state, 'address', co.address),
    'community', CASE WHEN cm.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', cm.id, 'name', cm.name, 'slug', cm.slug, 'logo_url', cm.logo_url,
      'brand_color', cm.brand_color, 'stripe_onboarding_complete', cm.stripe_onboarding_complete
    ) END,
    'confirmed', (SELECT count(*) FROM registrations WHERE event_id = ev.id AND status IN ('confirmed', 'checked_in', 'pending_payment')),
    'waitlisted', (SELECT count(*) FROM registrations WHERE event_id = ev.id AND status = 'waitlisted'),
    'tickets', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order) FROM event_ticket_types t WHERE t.event_id = ev.id), '[]'::jsonb),
    'addons', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.sort_order, a.created_at) FROM event_addons a WHERE a.event_id = ev.id), '[]'::jsonb),
    'sponsor_packages', coalesce((
      SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.price_cents DESC)
        FROM sponsor_packages sp
       WHERE sp.event_id = ev.id OR (ev.season_id IS NOT NULL AND sp.season_id = ev.season_id)
    ), '[]'::jsonb),
    'sponsors', coalesce((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.amount_paid_cents DESC, s.created_at)
        FROM sponsorships s
       WHERE s.status = 'active' AND (s.event_id = ev.id OR (ev.season_id IS NOT NULL AND s.season_id = ev.season_id))
    ), '[]'::jsonb),
    'donations_raised_cents', coalesce((SELECT sum(amount_cents)::int FROM event_donations d WHERE d.event_id = ev.id), 0),
    'donations_count', (SELECT count(*)::int FROM event_donations d WHERE d.event_id = ev.id),
    'recent_donations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'donor_name', CASE WHEN d.is_anonymous THEN 'Anonymous' ELSE d.donor_name END,
        'amount_cents', d.amount_cents,
        'message', d.message,
        'created_at', d.created_at
      ) ORDER BY d.created_at DESC)
      FROM (SELECT * FROM event_donations WHERE event_id = ev.id ORDER BY created_at DESC LIMIT 8) d
    ), '[]'::jsonb)
  )
  FROM events ev
  JOIN courses co ON co.id = ev.course_id
  LEFT JOIN communities cm ON cm.id = ev.community_id
  WHERE ev.id = p_event_id AND (public.event_is_public(ev.id) OR public.can_view_event(ev.id));
$$;

-- 2. Unified Checkout for Event Registration (Entry + Add-ons + Team Entries + Donation + Stripe Connect Split)
CREATE OR REPLACE FUNCTION public.checkout_event_registration(
  p_event_id uuid,
  p_ticket_type_id uuid DEFAULT NULL,
  p_team_name text DEFAULT NULL,
  p_team_Count integer DEFAULT 1,
  p_addons jsonb DEFAULT '[]'::jsonb,           -- [{addon_id, qty}]
  p_donation_cents integer DEFAULT 0,
  p_answers jsonb DEFAULT '{}'::jsonb,
  p_discount_code text DEFAULT NULL,
  p_payment_method text DEFAULT 'card',         -- 'card' | 'apple_pay' | 'google_pay' | 'saved_card' | 'course'
  p_save_card boolean DEFAULT false,
  p_card_brand text DEFAULT 'Visa',
  p_card_last4 text DEFAULT '4242'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev events%ROWTYPE;
  tt event_ticket_types%ROWTYPE;
  dc discount_codes%ROWTYPE;
  ad event_addons%ROWTYPE;
  reg registrations%ROWTYPE;
  pay payments%ROWTYPE;
  is_mem boolean := false;
  mem_disc_pct integer := 0;
  base_entry integer := 0;
  entry_total integer := 0;
  addons_total integer := 0;
  don_total integer := greatest(0, coalesce(p_donation_cents, 0));
  subtotal integer := 0;
  proc_fee integer := 0;
  plat_bps integer := 250;
  plat_fee integer := 0;
  grand_total integer := 0;
  team_id_val uuid := NULL;
  qty_mult integer := greatest(1, least(4, coalesce(p_team_count, 1)));
  item jsonb;
  q_item jsonb;
  addon_lines jsonb := '[]'::jsonb;
  confirmed_cnt integer := 0;
  next_wait integer := 1;
  reg_status public.registration_status := 'confirmed';
  dest_acct text := NULL;
  hcp numeric;
  prof_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING errcode = '28000'; END IF;
  SELECT * INTO ev FROM events WHERE id = p_event_id;
  IF NOT FOUND OR ev.status NOT IN ('published', 'live') THEN
    RAISE EXCEPTION 'This event is not open for registration' USING errcode = 'P0001';
  END IF;

  IF ev.community_id IS NOT NULL THEN
    is_mem := public.is_community_member(ev.community_id);
    SELECT coalesce(mt.member_discount_pct, 0) INTO mem_disc_pct
      FROM memberships m LEFT JOIN membership_tiers mt ON mt.id = m.tier_id
     WHERE m.community_id = ev.community_id AND m.profile_id = auth.uid() AND m.status = 'active'
     LIMIT 1;
    SELECT stripe_account_id, coalesce(platform_fee_bps, 250) INTO dest_acct, plat_bps
      FROM communities WHERE id = ev.community_id;
  ELSIF ev.organization_id IS NOT NULL THEN
    SELECT stripe_account_id, coalesce(platform_fee_bps, 250) INTO dest_acct, plat_bps
      FROM organizations WHERE id = ev.organization_id;
  END IF;

  IF ev.visibility = 'members_only' AND NOT is_mem THEN
    RAISE EXCEPTION 'This event is for members only' USING errcode = '42501';
  END IF;

  -- Check required questions
  FOR q_item IN SELECT * FROM jsonb_array_elements(ev.questions) LOOP
    IF coalesce((q_item->>'required')::boolean, false)
       AND coalesce(nullif(p_answers->>(q_item->>'id'), ''), 'false') IN ('false') THEN
      RAISE EXCEPTION 'Please answer: %', q_item->>'label' USING errcode = 'P0001';
    END IF;
  END LOOP;

  -- Ticket price
  IF p_ticket_type_id IS NOT NULL THEN
    SELECT * INTO tt FROM event_ticket_types WHERE id = p_ticket_type_id AND event_id = p_event_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid ticket type' USING errcode = 'P0001'; END IF;
    IF tt.members_only AND NOT is_mem THEN RAISE EXCEPTION 'That entry is for members only' USING errcode = '42501'; END IF;
    base_entry := CASE
      WHEN is_mem AND tt.member_price_cents IS NOT NULL THEN tt.member_price_cents
      WHEN is_mem AND mem_disc_pct > 0 THEN greatest(0, tt.price_cents - (tt.price_cents * mem_disc_pct / 100))
      ELSE tt.price_cents
    END;
  END IF;
  entry_total := base_entry * qty_mult;

  -- Discount code
  IF nullif(trim(p_discount_code), '') IS NOT NULL THEN
    SELECT * INTO dc FROM discount_codes
     WHERE lower(code) = lower(trim(p_discount_code))
       AND (event_id = p_event_id OR (ev.community_id IS NOT NULL AND community_id = ev.community_id))
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That discount code is not valid' USING errcode = 'P0001'; END IF;
    entry_total := greatest(0, CASE WHEN dc.percent_off IS NOT NULL THEN entry_total - (entry_total * dc.percent_off / 100)
                                    ELSE entry_total - dc.amount_off_cents END);
    UPDATE discount_codes SET used_count = used_count + 1 WHERE id = dc.id;
  END IF;

  -- Add-ons (mulligans, range balls, lunch, etc.)
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_addons, '[]'::jsonb)) LOOP
    IF coalesce((item->>'qty')::int, 0) > 0 THEN
      SELECT * INTO ad FROM event_addons WHERE id = (item->>'addon_id')::uuid AND event_id = p_event_id FOR UPDATE;
      IF FOUND THEN
        IF ad.stock_count IS NOT NULL AND ad.sold_count + (item->>'qty')::int > ad.stock_count THEN
          RAISE EXCEPTION 'Not enough % remaining', ad.name USING errcode = 'P0001';
        END IF;
        UPDATE event_addons SET sold_count = sold_count + (item->>'qty')::int WHERE id = ad.id;
        addons_total := addons_total + (ad.price_cents * (item->>'qty')::int);
        addon_lines := addon_lines || jsonb_build_array(jsonb_build_object(
          'addon_id', ad.id, 'name', ad.name, 'qty', (item->>'qty')::int, 'unit_cents', ad.price_cents
        ));
      END IF;
    END IF;
  END LOOP;

  -- Optional team creation
  IF nullif(trim(p_team_name), '') IS NOT NULL THEN
    INSERT INTO event_teams (event_id, name, captain_profile_id)
    VALUES (p_event_id, trim(p_team_name), auth.uid())
    RETURNING id INTO team_id_val;
  END IF;

  -- Capacity / Waitlist check
  SELECT count(*) INTO confirmed_cnt FROM registrations
   WHERE event_id = p_event_id AND status IN ('confirmed', 'checked_in', 'pending_payment');
  IF ev.capacity IS NOT NULL AND confirmed_cnt >= ev.capacity THEN
    IF NOT ev.allow_waitlist THEN RAISE EXCEPTION 'Event is full' USING errcode = 'P0001'; END IF;
    reg_status := 'waitlisted';
    SELECT coalesce(max(waitlist_position), 0) + 1 INTO next_wait
      FROM registrations WHERE event_id = p_event_id AND status = 'waitlisted';
  END IF;

  subtotal := entry_total + addons_total + don_total;
  IF subtotal > 0 AND reg_status <> 'waitlisted' AND p_payment_method <> 'course' THEN
    -- Stripe processing fee: 2.9% + 30c
    proc_fee := round(subtotal * 0.029)::int + 30;
    plat_fee := round(subtotal * (plat_bps / 10000.0))::int;
    grand_total := CASE WHEN ev.pass_processing_fee THEN subtotal + proc_fee ELSE subtotal END;
  ELSE
    grand_total := subtotal;
  END IF;

  SELECT handicap, username INTO hcp, prof_name FROM profiles WHERE id = auth.uid();

  -- Save payment method on golfer profile if requested
  IF p_save_card AND p_payment_method IN ('card', 'apple_pay', 'google_pay') THEN
    UPDATE profiles
       SET stripe_customer_id = coalesce(stripe_customer_id, 'cus_' || substr(replace(auth.uid()::text, '-', ''), 1, 14)),
           saved_pm_id = 'pm_' || substr(md5(random()::text), 1, 16),
           saved_pm_brand = coalesce(nullif(p_card_brand, ''), 'Visa'),
           saved_pm_last4 = coalesce(nullif(p_card_last4, ''), '4242')
     WHERE id = auth.uid();
  END IF;

  INSERT INTO registrations (
    event_id, profile_id, ticket_type_id, team_id, discount_code_id, status, waitlist_position,
    amount_due_cents, paid_at_course_at, addons, addons_cents, donation_cents,
    processing_fee_cents, platform_fee_cents, total_paid_cents, payment_method,
    stripe_payment_intent_id, answers, handicap
  ) VALUES (
    p_event_id, auth.uid(), p_ticket_type_id, team_id_val, dc.id, reg_status,
    CASE WHEN reg_status = 'waitlisted' THEN next_wait ELSE NULL END,
    grand_total,
    CASE WHEN grand_total = 0 OR (reg_status <> 'waitlisted' AND p_payment_method <> 'course') THEN now() ELSE NULL END,
    addon_lines, addons_total, don_total, proc_fee, plat_fee,
    CASE WHEN reg_status <> 'waitlisted' AND p_payment_method <> 'course' THEN grand_total ELSE 0 END,
    p_payment_method,
    CASE WHEN grand_total > 0 AND p_payment_method <> 'course' THEN 'pi_' || substr(md5(random()::text), 1, 20) ELSE NULL END,
    coalesce(p_answers, '{}'::jsonb), hcp
  ) RETURNING * INTO reg;

  IF grand_total > 0 AND reg_status <> 'waitlisted' THEN
    INSERT INTO payments (
      profile_id, community_id, organization_id, event_id, registration_id, kind,
      subtotal_cents, processing_fee_cents, platform_fee_cents, total_cents,
      net_organizer_cents, fee_absorbed_by_admin, payment_method, card_last4,
      stripe_payment_intent_id, stripe_destination_acct, status, line_items
    ) VALUES (
      auth.uid(), ev.community_id, ev.organization_id, ev.id, reg.id, 'event_entry',
      subtotal, proc_fee, plat_fee, grand_total,
      greatest(0, grand_total - proc_fee - plat_fee),
      NOT ev.pass_processing_fee, p_payment_method, coalesce(p_card_last4, '4242'),
      reg.stripe_payment_intent_id, dest_acct,
      CASE WHEN p_payment_method = 'course' THEN 'pending' ELSE 'succeeded' END,
      jsonb_build_array(jsonb_build_object('label', coalesce(tt.name, 'Event Entry') || (CASE WHEN qty_mult > 1 THEN ' × ' || qty_mult ELSE '' END), 'cents', entry_total))
        || addon_lines
        || (CASE WHEN don_total > 0 THEN jsonb_build_array(jsonb_build_object('label', 'Charity Donation', 'cents', don_total)) ELSE '[]'::jsonb END)
    ) RETURNING * INTO pay;
  END IF;

  IF don_total > 0 AND reg_status <> 'waitlisted' THEN
    INSERT INTO event_donations (event_id, profile_id, donor_name, amount_cents, message, payment_id)
    VALUES (ev.id, auth.uid(), coalesce(prof_name, 'Golfer'), don_total, 'Added at registration checkout', pay.id);
  END IF;

  RETURN jsonb_build_object('registration', to_jsonb(reg), 'payment', to_jsonb(pay));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You are already registered for this event' USING errcode = 'P0001';
END $$;

-- 3. Refund / Partial Refund from Admin Screen + Automatic Waitlist Promotion
CREATE OR REPLACE FUNCTION public.refund_payment(
  p_registration_id uuid,
  p_refund_cents integer DEFAULT NULL,
  p_cancel_spot boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reg registrations%ROWTYPE;
  ev events%ROWTYPE;
  pay payments%ROWTYPE;
  wait_reg registrations%ROWTYPE;
  amt integer;
  promoted_user uuid := NULL;
BEGIN
  SELECT * INTO reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found' USING errcode = 'P0002'; END IF;
  IF NOT public.can_manage_event(reg.event_id) THEN RAISE EXCEPTION 'Not allowed' USING errcode = '42501'; END IF;

  SELECT * INTO ev FROM events WHERE id = reg.event_id;
  SELECT * INTO pay FROM payments WHERE registration_id = reg.id ORDER BY created_at DESC LIMIT 1;

  amt := coalesce(p_refund_cents, greatest(0, reg.total_paid_cents - reg.refunded_cents), reg.amount_due_cents);

  UPDATE registrations
     SET refunded_cents = coalesce(refunded_cents, 0) + amt,
         status = CASE WHEN p_cancel_spot THEN 'cancelled'::public.registration_status ELSE status END,
         cancelled_at = CASE WHEN p_cancel_spot THEN now() ELSE cancelled_at END,
         waitlist_position = NULL
   WHERE id = reg.id
   RETURNING * INTO reg;

  IF pay.id IS NOT NULL THEN
    UPDATE payments
       SET refunded_cents = least(total_cents, coalesce(refunded_cents, 0) + amt),
           net_organizer_cents = greatest(0, net_organizer_cents - amt),
           status = CASE WHEN coalesce(refunded_cents, 0) + amt >= total_cents THEN 'refunded' ELSE 'partially_refunded' END,
           refunded_at = now()
     WHERE id = pay.id
     RETURNING * INTO pay;
  END IF;

  -- If spot was cancelled and there is a waitlist, promote #1 on the waitlist!
  IF p_cancel_spot THEN
    SELECT * INTO wait_reg FROM registrations
     WHERE event_id = reg.event_id AND status = 'waitlisted'
     ORDER BY waitlist_position ASC NULLS LAST, created_at ASC
     LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE registrations
         SET status = 'confirmed', waitlist_position = NULL, promoted_at = now()
       WHERE id = wait_reg.id;
      promoted_user := wait_reg.profile_id;
      INSERT INTO notification_outbox (profile_id, kind, payload)
      VALUES (wait_reg.profile_id, 'waitlist_promoted', jsonb_build_object(
        'event_id', ev.id, 'event_name', ev.name, 'message', 'A spot opened up! You have been promoted from the waitlist.'
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'registration', to_jsonb(reg),
    'payment', to_jsonb(pay),
    'promoted_profile_id', promoted_user
  );
END $$;

-- 4. Event Payout Reconciliation View
CREATE OR REPLACE FUNCTION public.event_payout_reconciliation(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev events%ROWTYPE;
  out jsonb;
BEGIN
  IF NOT public.can_manage_event(p_event_id) THEN RAISE EXCEPTION 'Not allowed' USING errcode = '42501'; END IF;
  SELECT * INTO ev FROM events WHERE id = p_event_id;
  SELECT jsonb_build_object(
    'gross_collected_cents', coalesce(sum(total_cents) FILTER (WHERE status IN ('succeeded', 'partially_refunded', 'refunded')), 0),
    'entry_and_addons_cents', coalesce(sum(subtotal_cents) FILTER (WHERE kind = 'event_entry' AND status <> 'failed'), 0),
    'sponsorships_cents', coalesce(sum(subtotal_cents) FILTER (WHERE kind = 'sponsorship' AND status <> 'failed'), 0),
    'donations_cents', coalesce(sum(subtotal_cents) FILTER (WHERE kind = 'donation' AND status <> 'failed'), 0),
    'processing_fees_cents', coalesce(sum(processing_fee_cents) FILTER (WHERE status <> 'failed'), 0),
    'platform_fees_cents', coalesce(sum(platform_fee_cents) FILTER (WHERE status <> 'failed'), 0),
    'refunds_cents', coalesce(sum(refunded_cents), 0),
    'net_payout_cents', coalesce(sum(net_organizer_cents) FILTER (WHERE status IN ('succeeded', 'partially_refunded')), 0),
    'payments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'total_cents', p.total_cents, 'refunded_cents', p.refunded_cents,
        'net_organizer_cents', p.net_organizer_cents, 'payment_method', p.payment_method,
        'status', p.status, 'created_at', p.created_at, 'username', pr.username
      ) ORDER BY p.created_at DESC)
      FROM payments p LEFT JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.event_id = p_event_id
    ), '[]'::jsonb)
  ) INTO out FROM payments WHERE event_id = p_event_id;
  RETURN out;
END $$;

-- 5. Purchase Sponsorship Package (Single Event or Season-Long)
CREATE OR REPLACE FUNCTION public.buy_sponsorship(
  p_package_id uuid,
  p_sponsor_name text,
  p_logo_url text DEFAULT NULL,
  p_website_url text DEFAULT NULL,
  p_hole_number integer DEFAULT NULL,
  p_shout_out_text text DEFAULT NULL,
  p_contact_email text DEFAULT NULL
) RETURNS public.sponsorships
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pkg sponsor_packages%ROWTYPE;
  sp sponsorships%ROWTYPE;
  pay payments%ROWTYPE;
  proc_fee integer;
  plat_fee integer;
BEGIN
  SELECT * INTO pkg FROM sponsor_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sponsor package not found' USING errcode = 'P0002'; END IF;
  IF pkg.quantity IS NOT NULL AND pkg.sold_count >= pkg.quantity THEN
    RAISE EXCEPTION 'This sponsor package is sold out' USING errcode = 'P0001';
  END IF;

  UPDATE sponsor_packages SET sold_count = sold_count + 1 WHERE id = pkg.id;

  proc_fee := CASE WHEN pkg.price_cents > 0 THEN round(pkg.price_cents * 0.029)::int + 30 ELSE 0 END;
  plat_fee := round(pkg.price_cents * 0.025)::int;

  INSERT INTO payments (
    profile_id, community_id, event_id, kind, subtotal_cents, processing_fee_cents,
    platform_fee_cents, total_cents, net_organizer_cents, payment_method,
    stripe_payment_intent_id, status, line_items
  ) VALUES (
    auth.uid(), pkg.community_id, pkg.event_id, 'sponsorship', pkg.price_cents,
    proc_fee, plat_fee, pkg.price_cents, greatest(0, pkg.price_cents - proc_fee - plat_fee),
    'card', 'pi_spon_' || substr(md5(random()::text), 1, 16), 'succeeded',
    jsonb_build_array(jsonb_build_object('label', pkg.name || ' (' || p_sponsor_name || ')', 'cents', pkg.price_cents))
  ) RETURNING * INTO pay;

  INSERT INTO sponsorships (
    package_id, event_id, season_id, community_id, sponsor_name, logo_url,
    website_url, hole_number, shout_out_text, contact_email, benefits,
    amount_paid_cents, payment_id, status, created_by
  ) VALUES (
    pkg.id, pkg.event_id, pkg.season_id, pkg.community_id, trim(p_sponsor_name),
    nullif(trim(p_logo_url), ''), nullif(trim(p_website_url), ''), p_hole_number,
    nullif(trim(p_shout_out_text), ''), nullif(trim(p_contact_email), ''),
    pkg.benefits, pkg.price_cents, pay.id, 'active', auth.uid()
  ) RETURNING * INTO sp;

  RETURN sp;
END $$;

-- 6. Standalone Charity Donation on Event Page
CREATE OR REPLACE FUNCTION public.make_event_donation(
  p_event_id uuid,
  p_donor_name text,
  p_amount_cents integer,
  p_message text DEFAULT NULL,
  p_is_anonymous boolean DEFAULT false
) RETURNS public.event_donations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev events%ROWTYPE;
  pay payments%ROWTYPE;
  don event_donations%ROWTYPE;
  proc_fee integer;
BEGIN
  IF coalesce(p_amount_cents, 0) < 100 THEN RAISE EXCEPTION 'Minimum donation is $1.00' USING errcode = 'P0001'; END IF;
  SELECT * INTO ev FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING errcode = 'P0002'; END IF;

  proc_fee := round(p_amount_cents * 0.029)::int + 30;
  INSERT INTO payments (
    profile_id, community_id, organization_id, event_id, kind, subtotal_cents,
    processing_fee_cents, platform_fee_cents, total_cents, net_organizer_cents,
    payment_method, stripe_payment_intent_id, status
  ) VALUES (
    auth.uid(), ev.community_id, ev.organization_id, ev.id, 'donation', p_amount_cents,
    proc_fee, 0, p_amount_cents, greatest(0, p_amount_cents - proc_fee),
    'card', 'pi_don_' || substr(md5(random()::text), 1, 16), 'succeeded'
  ) RETURNING * INTO pay;

  INSERT INTO event_donations (
    event_id, profile_id, donor_name, amount_cents, message, is_anonymous, payment_id
  ) VALUES (
    ev.id, auth.uid(), coalesce(nullif(trim(p_donor_name), ''), 'Anonymous Golfer'),
    p_amount_cents, nullif(trim(p_message), ''), coalesce(p_is_anonymous, false), pay.id
  ) RETURNING * INTO don;

  RETURN don;
END $$;

-- 7. Public Branded Community Page by Vanity Slug (/c/:slug)
CREATE OR REPLACE FUNCTION public.public_community_by_slug(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'community', to_jsonb(c),
    'course', CASE WHEN co.id IS NULL THEN NULL ELSE jsonb_build_object('id', co.id, 'name', co.name, 'city', co.city) END,
    'member_count', (SELECT count(*)::int FROM memberships m WHERE m.community_id = c.id AND m.status = 'active'),
    'tiers', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order, t.price_cents) FROM membership_tiers t WHERE t.community_id = c.id AND t.is_active), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.starts_at ASC)
        FROM events e WHERE e.community_id = c.id AND e.status IN ('published', 'live', 'completed')
    ), '[]'::jsonb),
    'seasons', coalesce((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.starts_on DESC)
        FROM seasons s WHERE s.community_id = c.id
    ), '[]'::jsonb),
    'sponsors', coalesce((
      SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.amount_paid_cents DESC)
        FROM sponsorships sp WHERE sp.community_id = c.id AND sp.status = 'active'
    ), '[]'::jsonb)
  )
  FROM communities c
  LEFT JOIN courses co ON co.id = c.home_course_id
  WHERE lower(c.slug) = lower(trim(p_slug)) AND c.privacy <> 'secret';
$$;

-- 8. Subscribe to Membership Tier & Recurring Dues
CREATE OR REPLACE FUNCTION public.subscribe_membership_tier(
  p_community_id uuid,
  p_tier_id uuid,
  p_payment_method text DEFAULT 'card'
) RETURNS public.memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t membership_tiers%ROWTYPE;
  m memberships%ROWTYPE;
  period_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING errcode = '28000'; END IF;
  SELECT * INTO t FROM membership_tiers WHERE id = p_tier_id AND community_id = p_community_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership tier not found' USING errcode = 'P0002'; END IF;

  period_end := CASE t.billing_interval
    WHEN 'monthly' THEN now() + interval '1 month'
    WHEN 'season'  THEN now() + interval '6 months'
    ELSE                now() + interval '1 year'
  END;

  IF t.price_cents > 0 THEN
    INSERT INTO payments (
      profile_id, community_id, kind, subtotal_cents, processing_fee_cents,
      platform_fee_cents, total_cents, net_organizer_cents, payment_method,
      stripe_payment_intent_id, status, line_items
    ) VALUES (
      auth.uid(), p_community_id, 'dues', t.price_cents,
      round(t.price_cents * 0.029)::int + 30, round(t.price_cents * 0.025)::int,
      t.price_cents, greatest(0, t.price_cents - (round(t.price_cents * 0.054)::int + 30)),
      p_payment_method, 'sub_' || substr(md5(random()::text), 1, 16), 'succeeded',
      jsonb_build_array(jsonb_build_object('label', t.name || ' (' || t.billing_interval || ' dues)', 'cents', t.price_cents))
    );
  END IF;

  INSERT INTO memberships (
    community_id, profile_id, status, tier_id, stripe_subscription_id,
    current_period_end, payment_status
  ) VALUES (
    p_community_id, auth.uid(), 'active', t.id,
    'sub_' || substr(md5(random()::text), 1, 14), period_end, 'active'
  )
  ON CONFLICT (community_id, profile_id) DO UPDATE
    SET status = 'active',
        tier_id = EXCLUDED.tier_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        current_period_end = EXCLUDED.current_period_end,
        payment_status = 'active',
        retry_count = 0
  RETURNING * INTO m;

  RETURN m;
END $$;

-- 9. Place Pro Shop / On-Course Concession Order (Shared Inventory)
CREATE OR REPLACE FUNCTION public.place_shop_order(
  p_community_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_course_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_channel text DEFAULT 'on_course',
  p_fulfillment text DEFAULT 'turn_pickup',
  p_hole_number integer DEFAULT NULL,
  p_cart_number text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb, -- [{product_id, qty}]
  p_notes text DEFAULT NULL
) RETURNS public.shop_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prod shop_products%ROWTYPE;
  item jsonb;
  lines jsonb := '[]'::jsonb;
  total integer := 0;
  is_mem boolean := false;
  unit_price integer;
  pay payments%ROWTYPE;
  ord shop_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING errcode = '28000'; END IF;
  IF p_community_id IS NOT NULL THEN is_mem := public.is_community_member(p_community_id); END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    IF coalesce((item->>'qty')::int, 0) > 0 THEN
      SELECT * INTO prod FROM shop_products WHERE id = (item->>'product_id')::uuid FOR UPDATE;
      IF NOT FOUND OR NOT prod.is_active THEN RAISE EXCEPTION 'Product unavailable' USING errcode = 'P0001'; END IF;
      IF prod.stock_count < (item->>'qty')::int THEN
        RAISE EXCEPTION 'Only % left of %', prod.stock_count, prod.name USING errcode = 'P0001';
      END IF;
      UPDATE shop_products SET stock_count = stock_count - (item->>'qty')::int WHERE id = prod.id;
      unit_price := CASE WHEN is_mem AND prod.member_price_cents IS NOT NULL THEN prod.member_price_cents ELSE prod.price_cents END;
      total := total + unit_price * (item->>'qty')::int;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'product_id', prod.id, 'name', prod.name, 'category', prod.category,
        'qty', (item->>'qty')::int, 'unit_cents', unit_price
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(lines) = 0 THEN RAISE EXCEPTION 'Add at least one item to your order' USING errcode = 'P0001'; END IF;

  INSERT INTO payments (
    profile_id, community_id, organization_id, event_id, kind, subtotal_cents,
    processing_fee_cents, platform_fee_cents, total_cents, net_organizer_cents,
    payment_method, stripe_payment_intent_id, status, line_items
  ) VALUES (
    auth.uid(), p_community_id, p_organization_id, p_event_id, 'shop_order', total,
    round(total * 0.029)::int + 30, round(total * 0.025)::int, total,
    greatest(0, total - (round(total * 0.054)::int + 30)),
    'saved_card', 'pi_shop_' || substr(md5(random()::text), 1, 16), 'succeeded', lines
  ) RETURNING * INTO pay;

  INSERT INTO shop_orders (
    profile_id, community_id, organization_id, course_id, event_id, channel,
    fulfillment, hole_number, cart_number, items, total_cents, status, payment_id, notes
  ) VALUES (
    auth.uid(), p_community_id, p_organization_id, p_course_id, p_event_id, p_channel,
    p_fulfillment, p_hole_number, nullif(trim(p_cart_number), ''), lines, total,
    'queued', pay.id, nullif(trim(p_notes), '')
  ) RETURNING * INTO ord;

  RETURN ord;
END $$;

-- Enable Realtime on Phase 2 & 3 live tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments', 'sponsorships', 'event_donations', 'shop_orders', 'community_posts', 'community_announcements'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- =====================================================================
-- 10. Canonical 26-Table Schema Alignment & Pricing Model Columns
-- =====================================================================

-- Pricing & revenue model columns on communities and organizations:
-- Community Free ($0 at partner courses, 6–7% all-in fee), Community Pro ($49–79/mo, 5–6% all-in fee), Operator (free during trial)
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro')),
  ADD COLUMN IF NOT EXISTS plan_monthly_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS all_in_fee_bps integer NOT NULL DEFAULT 650; -- 6.5% default on Free, 550 (5.5%) on Pro

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'operator_trial' CHECK (plan_tier IN ('operator_trial', 'operator_active')),
  ADD COLUMN IF NOT EXISTS all_in_fee_bps integer NOT NULL DEFAULT 550;

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS renewal_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewed_at timestamptz;

-- stripe_accounts: Connect account per payee (community or organization)
CREATE TABLE IF NOT EXISTS public.stripe_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id        uuid UNIQUE REFERENCES public.communities(id) ON DELETE CASCADE,
  organization_id     uuid UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_account_id   text NOT NULL UNIQUE,
  charges_enabled     boolean NOT NULL DEFAULT false,
  payouts_enabled     boolean NOT NULL DEFAULT false,
  payout_schedule     text NOT NULL DEFAULT 'daily' CHECK (payout_schedule IN ('daily', 'weekly', 'monthly', 'manual')),
  onboarding_complete boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(community_id, organization_id) = 1)
);

-- Canonical aliases/tables from the 26-table specification (`sponsors`, `products`, `orders`, `order_items`, `announcements`)
CREATE TABLE IF NOT EXISTS public.sponsors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          uuid REFERENCES public.sponsor_packages(id) ON DELETE SET NULL,
  event_id            uuid REFERENCES public.events(id) ON DELETE CASCADE,
  season_id           uuid REFERENCES public.seasons(id) ON DELETE CASCADE,
  community_id        uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  business_name       text NOT NULL,
  contact_email       text,
  logo_url            text,
  website_url         text,
  hole_number         integer CHECK (hole_number BETWEEN 1 AND 18),
  shoutout_text       text,
  amount_paid_cents   integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id        uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  organization_id     uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id           uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  name                text NOT NULL,
  description         text,
  category            text NOT NULL DEFAULT 'concession' CHECK (category IN ('merch', 'concession', 'addon')),
  price_cents         integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  member_price_cents  integer CHECK (member_price_cents >= 0),
  stock_count         integer DEFAULT 100,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  community_id        uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  organization_id     uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id           uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  event_id            uuid REFERENCES public.events(id) ON DELETE SET NULL,
  fulfillment_type    text NOT NULL DEFAULT 'turn_pickup' CHECK (fulfillment_type IN ('turn_pickup', 'cart_delivery', 'pro_shop_pickup', 'online')),
  hole_number         integer CHECK (hole_number BETWEEN 1 AND 18),
  cart_number         text,
  total_cents         integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'preparing', 'ready', 'delivered', 'completed', 'cancelled')),
  payment_id          uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id          uuid REFERENCES public.products(id) ON DELETE SET NULL,
  name                text NOT NULL,
  category            text NOT NULL DEFAULT 'concession',
  qty                 integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_cents          integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id        uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  event_id            uuid REFERENCES public.events(id) ON DELETE CASCADE,
  sender_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title               text NOT NULL,
  body                text NOT NULL,
  channels            text[] NOT NULL DEFAULT '{in_app,email}',
  scheduled_for       timestamptz,
  sent_at             timestamptz DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY stripe_accounts_read ON public.stripe_accounts FOR SELECT USING (auth.role() = 'authenticated');
  CREATE POLICY sponsors_read ON public.sponsors FOR SELECT USING (true);
  CREATE POLICY products_read ON public.products FOR SELECT USING (true);
  CREATE POLICY orders_read ON public.orders FOR SELECT USING (profile_id = auth.uid() OR (organization_id IS NOT NULL AND public.is_org_staff(organization_id)) OR (community_id IS NOT NULL AND public.is_community_admin(community_id)));
  CREATE POLICY order_items_read ON public.order_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.profile_id = auth.uid() OR (o.organization_id IS NOT NULL AND public.is_org_staff(o.organization_id)))));
  CREATE POLICY announcements_read ON public.announcements FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Storage buckets: community logos, sponsor logos, event photos, scanned scorecards
DO $$ BEGIN
  INSERT INTO storage.buckets (id, name, public) VALUES
    ('community-logos', 'community-logos', true),
    ('sponsor-logos', 'sponsor-logos', true),
    ('event-photos', 'event-photos', true),
    ('scanned-scorecards', 'scanned-scorecards', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN undefined_table OR insufficient_privilege THEN NULL; END $$;

-- pg_cron scheduled jobs for event reminders and membership renewal checks (runs when pg_cron is enabled)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'foresome-event-reminders-hourly',
      '0 * * * *',
      $cron$
        INSERT INTO public.notification_outbox (profile_id, kind, payload)
        SELECT r.profile_id, 'event_reminder_24h', jsonb_build_object('event_id', e.id, 'event_name', e.name, 'starts_at', e.starts_at)
        FROM public.registrations r
        JOIN public.events e ON e.id = r.event_id
        WHERE r.status IN ('confirmed', 'checked_in')
          AND e.starts_at BETWEEN now() + interval '23 hours' AND now() + interval '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_outbox o
            WHERE o.profile_id = r.profile_id AND o.kind = 'event_reminder_24h' AND (o.payload->>'event_id')::uuid = e.id
          );
      $cron$
    );
    PERFORM cron.schedule(
      'foresome-membership-renewal-check-daily',
      '15 8 * * *',
      $cron$
        INSERT INTO public.notification_outbox (profile_id, kind, payload)
        SELECT m.profile_id, 'membership_renewal_reminder', jsonb_build_object('community_id', m.community_id, 'tier_id', m.tier_id, 'current_period_end', m.current_period_end)
        FROM public.memberships m
        WHERE m.status = 'active'
          AND m.current_period_end BETWEEN now() AND now() + interval '3 days';
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- =====================================================================
-- 11. Operator Dashboard RPC — All 7 Panels (Phases 1, 2 & 3)
-- Filters by course (p_course_id), date range (p_from..p_to), and community (p_community_id)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.org_dashboard(
  p_org_id uuid,
  p_from date,
  p_to date,
  p_course_id uuid DEFAULT NULL,
  p_community_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  IF NOT public.is_org_staff(p_org_id) THEN
    RAISE EXCEPTION 'Not allowed' USING errcode = '42501';
  END IF;

  WITH
  -- Operator courses (filtered by p_course_id when provided)
  all_oc AS (
    SELECT id, name FROM courses WHERE organization_id = p_org_id
  ),
  oc AS (
    SELECT id, name FROM all_oc WHERE p_course_id IS NULL OR id = p_course_id
  ),
  -- Events at operator courses (filtered by course and community)
  ev AS (
    SELECT e.*, (SELECT name FROM courses c WHERE c.id = e.course_id) AS course_name,
           (SELECT name FROM communities cm WHERE cm.id = e.community_id) AS community_name
    FROM events e
    WHERE (e.course_id IN (SELECT id FROM oc) OR (p_course_id IS NULL AND e.organization_id = p_org_id))
      AND (p_community_id IS NULL OR e.community_id = p_community_id)
  ),
  ev_range AS (
    SELECT * FROM ev WHERE starts_at::date BETWEEN p_from AND p_to AND status <> 'cancelled'
  ),
  rg AS (
    SELECT r.*, e.course_id, e.course_name, e.community_id, e.community_name, e.starts_at, e.name AS event_name
    FROM registrations r
    JOIN ev_range e ON e.id = r.event_id
  ),
  -- Communities active at this operator's courses
  org_communities AS (
    SELECT DISTINCT c.id, c.name, c.slug, c.home_course_id
    FROM communities c
    WHERE (c.home_course_id IN (SELECT id FROM oc)
           OR EXISTS (SELECT 1 FROM events e WHERE e.community_id = c.id AND e.course_id IN (SELECT id FROM oc)))
      AND (p_community_id IS NULL OR c.id = p_community_id)
  ),
  -- Concessions / Shop orders at operator courses in range
  ord_range AS (
    SELECT so.*,
           coalesce((SELECT name FROM courses c WHERE c.id = so.course_id), 'Clubhouse') AS course_name
    FROM shop_orders so
    WHERE (so.organization_id = p_org_id OR so.course_id IN (SELECT id FROM oc))
      AND (p_course_id IS NULL OR so.course_id = p_course_id)
      AND (p_community_id IS NULL OR so.community_id = p_community_id)
      AND so.created_at::date BETWEEN p_from AND p_to
      AND so.status <> 'cancelled'
  )
  SELECT jsonb_build_object(
    -- Filter dropdown options
    'courses', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb) FROM all_oc),
    'communities', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name), '[]'::jsonb)
      FROM (
        SELECT DISTINCT cm.id, cm.name
        FROM communities cm
        WHERE cm.home_course_id IN (SELECT id FROM all_oc)
           OR EXISTS (SELECT 1 FROM events e WHERE e.community_id = cm.id AND e.course_id IN (SELECT id FROM all_oc))
      ) c
    ),

    -- KPI Summary Cards
    'checkins_today', (
      SELECT count(*) FROM rg
      WHERE (checked_in_at AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
    ),
    'entries_total', (SELECT count(*) FROM rg WHERE public.holds_spot(status)),
    'cross_course_players', (
      SELECT count(*) FROM (
        SELECT profile_id FROM rg
        WHERE status IN ('confirmed', 'checked_in')
        GROUP BY profile_id HAVING count(DISTINCT course_id) >= 2
      ) s
    ),
    'fees_due_cents', (SELECT coalesce(sum(amount_due_cents), 0) FROM rg WHERE public.holds_spot(status)),
    'fees_collected_cents', (
      SELECT coalesce(sum(amount_due_cents), 0) FROM rg
      WHERE (paid_at_course_at IS NOT NULL OR status = 'checked_in')
    ),

    -- PANEL 1 (Phase 1): Upcoming events — Events at each course, registrations vs capacity, waitlist size
    'upcoming', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'starts_at'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'starts_at', e.starts_at,
          'status', e.status,
          'course_id', e.course_id,
          'course', coalesce(e.course_name, 'Course'),
          'community_id', e.community_id,
          'community', coalesce(e.community_name, 'Course Event'),
          'capacity', e.capacity,
          'registered', (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND public.holds_spot(r.status)),
          'waitlist', (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted'),
          'checked_in', (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'checked_in')
        ) AS x
        FROM ev_range e
      ) s
    ),

    -- PANEL 2 (Phase 1): Check-ins — Live check-ins by course and tee time
    'checkins_by_slot', (
      SELECT coalesce(jsonb_agg(c ORDER BY c->>'tee_time'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'course', coalesce(r.course_name, 'Course'),
          'event_id', r.event_id,
          'event_name', r.event_name,
          'community', coalesce(r.community_name, 'Course Event'),
          'tee_time', coalesce(p.tee_time, r.starts_at),
          'group_number', coalesce(p.group_number, 1),
          'starting_hole', coalesce(p.starting_hole, 1),
          'total_players', count(*),
          'checked_in', count(*) FILTER (WHERE r.status = 'checked_in'),
          'players', jsonb_agg(jsonb_build_object(
            'username', coalesce(pr.username, 'Player'),
            'status', r.status,
            'checked_in_at', r.checked_in_at
          ) ORDER BY pr.username)
        ) AS c
        FROM rg r
        LEFT JOIN profiles pr ON pr.id = r.profile_id
        LEFT JOIN pairing_players pp ON pp.registration_id = r.id
        LEFT JOIN pairings p ON p.id = pp.pairing_id
        WHERE public.holds_spot(r.status)
        GROUP BY r.course_name, r.event_id, r.event_name, r.community_name, coalesce(p.tee_time, r.starts_at), coalesce(p.group_number, 1), coalesce(p.starting_hole, 1)
        LIMIT 50
      ) s
    ),

    -- PANEL 3 (Phase 1): Top communities — Groups ranked by rounds, entries, and spend at Orion courses
    'top_communities', (
      SELECT coalesce(jsonb_agg(t ORDER BY (t->>'spend_cents')::bigint DESC, (t->>'entries')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'events', count(DISTINCT r.event_id),
          'entries', count(*) FILTER (WHERE public.holds_spot(r.status)),
          'rounds', count(*) FILTER (WHERE r.status = 'checked_in' OR r.round_id IS NOT NULL),
          'spend_cents', coalesce(sum(r.amount_due_cents) FILTER (WHERE public.holds_spot(r.status)), 0)
            + coalesce((
              SELECT sum(p.total_cents) FROM payments p
              WHERE p.community_id = c.id AND p.status = 'succeeded'
                AND p.created_at::date BETWEEN p_from AND p_to
            ), 0)
        ) AS t
        FROM org_communities c
        LEFT JOIN rg r ON r.community_id = c.id
        GROUP BY c.id, c.name
        ORDER BY 1 DESC
        LIMIT 20
      ) s
    ),

    -- PANEL 4 (Phase 1): Cross-course play — Golfers who played 2+ Orion courses this season; loyalty tier counts
    'cross_course_play', (
      SELECT coalesce(jsonb_agg(cp ORDER BY (cp->>'courses_played')::int DESC, (cp->>'rounds_played')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'profile_id', r.profile_id,
          'username', coalesce(p.username, 'Golfer'),
          'courses_played', count(DISTINCT r.course_id),
          'rounds_played', count(*),
          'courses_list', string_agg(DISTINCT r.course_name, ', '),
          'spend_cents', coalesce(sum(r.amount_due_cents), 0),
          'loyalty_tier', CASE
            WHEN count(DISTINCT r.course_id) >= 4 THEN 'Gold (4+ Courses)'
            WHEN count(DISTINCT r.course_id) = 3 THEN 'Silver (3 Courses)'
            ELSE 'Bronze (2 Courses)'
          END
        ) AS cp
        FROM rg r
        LEFT JOIN profiles p ON p.id = r.profile_id
        WHERE r.status IN ('confirmed', 'checked_in')
        GROUP BY r.profile_id, p.username
        HAVING count(DISTINCT r.course_id) >= 2
        LIMIT 50
      ) s
    ),
    'cross_course_loyalty_tiers', (
      WITH player_courses AS (
        SELECT profile_id, count(DISTINCT course_id) AS c_cnt
        FROM rg
        WHERE status IN ('confirmed', 'checked_in')
        GROUP BY profile_id
        HAVING count(DISTINCT course_id) >= 2
      )
      SELECT jsonb_build_object(
        'bronze_2_courses', count(*) FILTER (WHERE c_cnt = 2),
        'silver_3_courses', count(*) FILTER (WHERE c_cnt = 3),
        'gold_4_plus_courses', count(*) FILTER (WHERE c_cnt >= 4),
        'total_multi_course', count(*)
      ) FROM player_courses
    ),

    -- PANEL 5 (Phase 2): Event revenue — Entries, add-ons, sponsors, donations, fees, net per event
    'event_revenue', (
      SELECT coalesce(jsonb_agg(er ORDER BY er->>'starts_at' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'event_id', e.id,
          'event_name', e.name,
          'course', coalesce(e.course_name, 'Course'),
          'community', coalesce(e.community_name, 'Course Event'),
          'starts_at', e.starts_at,
          'entries_cents', coalesce((
            SELECT sum(greatest(0, r.amount_due_cents - coalesce(r.addons_total_cents, 0) - coalesce(r.donation_cents, 0) - coalesce(r.processing_fee_cents, 0)))
            FROM registrations r WHERE r.event_id = e.id AND public.holds_spot(r.status)
          ), 0),
          'addons_cents', coalesce((
            SELECT sum(coalesce(r.addons_total_cents, 0))
            FROM registrations r WHERE r.event_id = e.id AND public.holds_spot(r.status)
          ), 0),
          'sponsors_cents', coalesce((
            SELECT sum(sp.amount_paid_cents) FROM sponsorships sp WHERE sp.event_id = e.id AND sp.status = 'active'
          ), 0),
          'donations_cents', coalesce((
            SELECT sum(d.amount_cents) FROM event_donations d WHERE d.event_id = e.id
          ), 0),
          'fees_cents', coalesce((
            SELECT sum(coalesce(p.processing_fee_cents, 0) + coalesce(p.platform_fee_cents, 0))
            FROM payments p WHERE p.event_id = e.id AND p.status IN ('succeeded', 'partially_refunded')
          ), 0),
          'refunded_cents', coalesce((
            SELECT sum(coalesce(p.refunded_cents, 0))
            FROM payments p WHERE p.event_id = e.id
          ), 0),
          'net_cents', coalesce((
            SELECT sum(greatest(0, coalesce(p.net_organizer_cents, 0) - coalesce(p.refunded_cents, 0)))
            FROM payments p WHERE p.event_id = e.id AND p.status IN ('succeeded', 'partially_refunded')
          ), 0) + coalesce((
            SELECT sum(r.amount_due_cents)
            FROM registrations r WHERE r.event_id = e.id AND r.payment_id IS NULL AND public.holds_spot(r.status)
          ), 0)
        ) AS er
        FROM ev_range e
      ) s
    ),

    -- PANEL 6 (Phase 3): Concessions — Orders, revenue, top items, by course and hour
    'concessions', jsonb_build_object(
      'orders_count', (SELECT count(*) FROM ord_range),
      'revenue_cents', (SELECT coalesce(sum(total_cents), 0) FROM ord_range),
      'by_course_hour', (
        SELECT coalesce(jsonb_agg(ch ORDER BY ch->>'course', (ch->>'hour_24')::int), '[]'::jsonb) FROM (
          SELECT jsonb_build_object(
            'course', course_name,
            'hour_24', extract(hour FROM created_at AT TIME ZONE 'America/Chicago')::int,
            'hour_label', to_char(date_trunc('hour', created_at AT TIME ZONE 'America/Chicago'), 'HH12 AM'),
            'fulfillment', fulfillment,
            'orders_count', count(*),
            'revenue_cents', coalesce(sum(total_cents), 0)
          ) AS ch
          FROM ord_range
          GROUP BY course_name, extract(hour FROM created_at AT TIME ZONE 'America/Chicago')::int,
                   to_char(date_trunc('hour', created_at AT TIME ZONE 'America/Chicago'), 'HH12 AM'), fulfillment
        ) s
      ),
      'top_items', (
        SELECT coalesce(jsonb_agg(ti ORDER BY (ti->>'qty_sold')::int DESC), '[]'::jsonb) FROM (
          SELECT jsonb_build_object(
            'item_name', coalesce(item->>'name', 'Concession Item'),
            'category', coalesce(item->>'category', 'concession'),
            'qty_sold', sum(coalesce((item->>'qty')::int, 1)),
            'revenue_cents', sum(coalesce((item->>'qty')::int, 1) * coalesce((item->>'unit_cents')::int, (item->>'price_cents')::int, 0))
          ) AS ti
          FROM ord_range o,
          LATERAL jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) AS item
          GROUP BY coalesce(item->>'name', 'Concession Item'), coalesce(item->>'category', 'concession')
          LIMIT 20
        ) s
      )
    ),

    -- PANEL 7 (Phase 3): Member growth — New members and renewals per community at Orion courses
    'member_growth', (
      SELECT coalesce(jsonb_agg(mg ORDER BY (mg->>'new_members')::int DESC, (mg->>'active_members')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'community_id', c.id,
          'community_name', c.name,
          'home_course', coalesce((SELECT name FROM courses co WHERE co.id = c.home_course_id), 'Multiple Orion Courses'),
          'new_members', (
            SELECT count(*) FROM memberships m
            WHERE m.community_id = c.id AND m.joined_at::date BETWEEN p_from AND p_to
          ),
          'renewals', (
            SELECT count(*) FROM memberships m
            WHERE m.community_id = c.id
              AND (m.renewal_count > 0 OR (m.renewed_at IS NOT NULL AND m.renewed_at::date BETWEEN p_from AND p_to))
          ) + (
            SELECT count(*) FROM payments p
            WHERE p.community_id = c.id AND p.kind = 'membership_dues'
              AND p.created_at::date BETWEEN p_from AND p_to
          ),
          'active_members', (
            SELECT count(*) FROM memberships m
            WHERE m.community_id = c.id AND m.status = 'active'
          ),
          'dues_revenue_cents', coalesce((
            SELECT sum(p.total_cents) FROM payments p
            WHERE p.community_id = c.id AND p.kind = 'membership_dues' AND p.status = 'succeeded'
              AND p.created_at::date BETWEEN p_from AND p_to
          ), 0)
        ) AS mg
        FROM org_communities c
      ) s
    )
  ) INTO out;

  RETURN out;
END $$;

GRANT EXECUTE ON FUNCTION public.org_dashboard(uuid, date, date, uuid, uuid) TO authenticated;


