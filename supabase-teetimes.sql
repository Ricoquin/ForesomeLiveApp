-- ForeSome: Tee Time Booking Engine
-- Run this in your Supabase SQL Editor

-- 1. Partner Courses — courses that have joined the platform
CREATE TABLE IF NOT EXISTS partner_courses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  zip text DEFAULT '',
  lat double precision DEFAULT 0,
  lng double precision DEFAULT 0,
  phone text DEFAULT '',
  logo_url text DEFAULT '',
  description text DEFAULT '',
  website text DEFAULT '',
  holes_count int DEFAULT 18,
  par int DEFAULT 72,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Tee Times — available slots posted by courses
CREATE TABLE IF NOT EXISTS tee_times (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id uuid REFERENCES partner_courses(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  time time NOT NULL,
  price decimal(8,2) DEFAULT 0,
  spots_total int DEFAULT 4,
  spots_remaining int DEFAULT 4,
  holes int DEFAULT 18 CHECK (holes IN (9, 18)),
  notes text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 3. Bookings — user reservations
CREATE TABLE IF NOT EXISTS bookings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tee_time_id uuid REFERENCES tee_times(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  players int DEFAULT 1 CHECK (players >= 1 AND players <= 4),
  status text DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

-- 4. Enable RLS
ALTER TABLE partner_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tee_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- 5. Helper: get courses owned by user (SECURITY DEFINER to avoid recursion)
CREATE OR REPLACE FUNCTION get_my_course_ids(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM partner_courses WHERE owner_id = uid;
$$;

-- 6. RLS for partner_courses
CREATE POLICY "Anyone can view active courses" ON partner_courses
  FOR SELECT USING (is_active = true);

CREATE POLICY "Authenticated users can create courses" ON partner_courses
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Owners can update their courses" ON partner_courses
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Owners can delete their courses" ON partner_courses
  FOR DELETE USING (auth.uid() = owner_id);

-- 7. RLS for tee_times
CREATE POLICY "Anyone can view active tee times" ON tee_times
  FOR SELECT USING (is_active = true);

CREATE POLICY "Course owners can add tee times" ON tee_times
  FOR INSERT WITH CHECK (
    course_id IN (SELECT get_my_course_ids(auth.uid()))
  );

CREATE POLICY "Course owners can update tee times" ON tee_times
  FOR UPDATE USING (
    course_id IN (SELECT get_my_course_ids(auth.uid()))
  );

CREATE POLICY "Course owners can delete tee times" ON tee_times
  FOR DELETE USING (
    course_id IN (SELECT get_my_course_ids(auth.uid()))
  );

-- 8. RLS for bookings
CREATE POLICY "Users can view their own bookings" ON bookings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Course owners can view bookings for their courses" ON bookings
  FOR SELECT USING (
    tee_time_id IN (
      SELECT tt.id FROM tee_times tt WHERE tt.course_id IN (SELECT get_my_course_ids(auth.uid()))
    )
  );

CREATE POLICY "Authenticated users can create bookings" ON bookings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bookings" ON bookings
  FOR UPDATE USING (auth.uid() = user_id);

-- 9. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tee_times_date ON tee_times(date, time);
CREATE INDEX IF NOT EXISTS idx_tee_times_course ON tee_times(course_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_courses_state ON partner_courses(state, city);
CREATE INDEX IF NOT EXISTS idx_partner_courses_location ON partner_courses(lat, lng);

-- 10. Function to decrement spots when booking
CREATE OR REPLACE FUNCTION handle_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    UPDATE tee_times SET spots_remaining = spots_remaining - NEW.players
    WHERE id = NEW.tee_time_id AND spots_remaining >= NEW.players;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not enough spots available';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
    UPDATE tee_times SET spots_remaining = spots_remaining + OLD.players
    WHERE id = OLD.tee_time_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER booking_spots_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION handle_booking();
