-- Quick fix: Make groups INSERT policy more permissive for authenticated users
-- Run this in Supabase SQL Editor

DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;

CREATE POLICY "Authenticated users can create groups" ON groups
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
