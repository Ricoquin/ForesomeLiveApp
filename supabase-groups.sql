-- ForeSome: Private Groups System
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Create groups table
CREATE TABLE IF NOT EXISTS groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text DEFAULT '',
  admin_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  avatar_emoji text DEFAULT '⛳',
  is_private boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Create group_members table
CREATE TABLE IF NOT EXISTS group_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status text DEFAULT 'invited' CHECK (status IN ('active', 'invited', 'removed')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- 3. Create group_messages table
CREATE TABLE IF NOT EXISTS group_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4. Enable Row Level Security
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for groups
CREATE POLICY "Members can view their groups" ON groups
  FOR SELECT USING (
    auth.uid() = admin_id OR
    EXISTS (SELECT 1 FROM group_members WHERE group_members.group_id = groups.id AND group_members.user_id = auth.uid() AND group_members.status IN ('active', 'invited'))
  );

CREATE POLICY "Authenticated users can create groups" ON groups
  FOR INSERT WITH CHECK (auth.uid() = admin_id);

CREATE POLICY "Admin can update their groups" ON groups
  FOR UPDATE USING (auth.uid() = admin_id);

CREATE POLICY "Admin can delete their groups" ON groups
  FOR DELETE USING (auth.uid() = admin_id);

-- 6. RLS Policies for group_members
CREATE POLICY "Members can view group members" ON group_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid() AND gm.status IN ('active', 'invited'))
    OR EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.admin_id = auth.uid())
  );

CREATE POLICY "Admin can add members" ON group_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.admin_id = auth.uid())
  );

CREATE POLICY "Admin can update members" ON group_members
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.admin_id = auth.uid())
    OR (auth.uid() = group_members.user_id)
  );

CREATE POLICY "Admin can remove members" ON group_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.admin_id = auth.uid())
    OR auth.uid() = group_members.user_id
  );

-- 7. RLS Policies for group_messages
CREATE POLICY "Members can view group messages" ON group_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = group_messages.group_id AND gm.user_id = auth.uid() AND gm.status = 'active')
    OR EXISTS (SELECT 1 FROM groups g WHERE g.id = group_messages.group_id AND g.admin_id = auth.uid())
  );

CREATE POLICY "Active members can send messages" ON group_messages
  FOR INSERT WITH CHECK (
    auth.uid() = group_messages.user_id AND (
      EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = group_messages.group_id AND gm.user_id = auth.uid() AND gm.status = 'active')
      OR EXISTS (SELECT 1 FROM groups g WHERE g.id = group_messages.group_id AND g.admin_id = auth.uid())
    )
  );

-- 8. Create index for faster message queries
CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id, status);
