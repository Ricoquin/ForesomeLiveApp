-- ForeSome: Player Search, Invite & Friend System
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Add bio column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio text DEFAULT '';

-- 2. Create friends table
CREATE TABLE IF NOT EXISTS friends (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  friend_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- 3. Create invites table
CREATE TABLE IF NOT EXISTS invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  from_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  to_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  course_name text NOT NULL,
  tee_time text DEFAULT '',
  tee_date text DEFAULT '',
  message text DEFAULT '',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz DEFAULT now()
);

-- 4. Enable Row Level Security
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for friends
CREATE POLICY "Users can view their own friends" ON friends
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can send friend requests" ON friends
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update friend requests sent to them" ON friends
  FOR UPDATE USING (auth.uid() = friend_id);

CREATE POLICY "Users can delete their own friend connections" ON friends
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- 6. RLS Policies for invites
CREATE POLICY "Users can view invites they sent or received" ON invites
  FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Users can send invites" ON invites
  FOR INSERT WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY "Users can update invites sent to them" ON invites
  FOR UPDATE USING (auth.uid() = to_user_id);

CREATE POLICY "Users can delete invites they sent" ON invites
  FOR DELETE USING (auth.uid() = from_user_id);

-- 7. Allow all authenticated users to search profiles
CREATE POLICY "Authenticated users can search profiles" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');
