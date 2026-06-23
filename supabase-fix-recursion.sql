-- Fix infinite recursion in group_members RLS policies
-- Run this in Supabase SQL Editor

-- ============================================
-- STEP 1: Create a helper function (SECURITY DEFINER)
-- This bypasses RLS so policies don't self-reference
-- ============================================
CREATE OR REPLACE FUNCTION get_my_group_ids(uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT group_id FROM group_members WHERE user_id = uid AND status IN ('active', 'invited')
  UNION
  SELECT id FROM groups WHERE admin_id = uid;
$$;

-- ============================================
-- STEP 2: Drop ALL existing policies
-- ============================================
DROP POLICY IF EXISTS "Members can view their groups" ON groups;
DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;
DROP POLICY IF EXISTS "Admin can update their groups" ON groups;
DROP POLICY IF EXISTS "Admin can delete their groups" ON groups;

DROP POLICY IF EXISTS "Members can view group members" ON group_members;
DROP POLICY IF EXISTS "Admin can add members" ON group_members;
DROP POLICY IF EXISTS "Admin can update members" ON group_members;
DROP POLICY IF EXISTS "Admin can remove members" ON group_members;

DROP POLICY IF EXISTS "Members can view group messages" ON group_messages;
DROP POLICY IF EXISTS "Active members can send messages" ON group_messages;

-- ============================================
-- STEP 3: Recreate groups policies (no recursion)
-- ============================================
CREATE POLICY "Users can view groups they belong to" ON groups
  FOR SELECT USING (groups.id IN (SELECT get_my_group_ids(auth.uid())));

CREATE POLICY "Authenticated users can create groups" ON groups
  FOR INSERT WITH CHECK (auth.uid() = admin_id);

CREATE POLICY "Admin can update their groups" ON groups
  FOR UPDATE USING (auth.uid() = admin_id);

CREATE POLICY "Admin can delete their groups" ON groups
  FOR DELETE USING (auth.uid() = admin_id);

-- ============================================
-- STEP 4: Recreate group_members policies (no recursion)
-- Uses the helper function instead of self-referencing
-- ============================================
CREATE POLICY "Users can view group members" ON group_members
  FOR SELECT USING (group_members.group_id IN (SELECT get_my_group_ids(auth.uid())));

CREATE POLICY "Admin can add members" ON group_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.admin_id = auth.uid())
  );

CREATE POLICY "Users can update own membership or admin can update" ON group_members
  FOR UPDATE USING (
    auth.uid() = group_members.user_id
    OR EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.admin_id = auth.uid())
  );

CREATE POLICY "Users can leave or admin can remove" ON group_members
  FOR DELETE USING (
    auth.uid() = group_members.user_id
    OR EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.admin_id = auth.uid())
  );

-- ============================================
-- STEP 5: Recreate group_messages policies (no recursion)
-- ============================================
CREATE POLICY "Members can view group messages" ON group_messages
  FOR SELECT USING (group_messages.group_id IN (SELECT get_my_group_ids(auth.uid())));

CREATE POLICY "Members can send messages" ON group_messages
  FOR INSERT WITH CHECK (
    auth.uid() = group_messages.user_id
    AND group_messages.group_id IN (SELECT get_my_group_ids(auth.uid()))
  );
