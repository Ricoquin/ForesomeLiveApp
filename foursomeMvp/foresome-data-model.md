# ForeSome — Data Model (Groups + Tee Times)

**Status:** Phase 2 foundation. Not part of Friday's scorecard launch — reference for when matching/Groups get built. Stack: Supabase (Postgres + RLS).

> Note: this covers the **matching/Groups** layer. The Friday scorecard launch needs its own tables (rounds, hole_scores, courses) — those are separate and simpler. This doc is the social-layer foundation already designed so it's ready when Phase 2 arrives.

---

## Core tables

```sql
groups
  id              uuid pk
  name            text              -- "The Women's Locker Room"
  slug            text unique       -- branded URL / invite path
  visibility      enum('private','public')
  join_policy     enum('open','invite','approval')
  created_by      uuid -> users.id
  created_at      timestamptz

group_members
  id              uuid pk
  group_id        uuid -> groups.id
  user_id         uuid -> users.id
  role            enum('group_admin','member')
  status          enum('active','pending','removed')
  joined_at       timestamptz
  UNIQUE(group_id, user_id)          -- one membership per user per group

user_roles                           -- platform-level, separate from group role
  user_id         uuid -> users.id
  role            enum('super_admin','user')

tee_times
  id              uuid pk
  posted_by       uuid -> users.id
  visibility      enum('public','group')
  group_id        uuid -> groups.id   -- null when visibility='public'
  course          text
  datetime        timestamptz
  slots_total     int
  slots_filled    int
  notes           text
```

**Two role layers on purpose.** `user_roles` is platform-wide (Rico = super_admin). `group_members.role` is scoped per group. A user can be group_admin in one group and a plain member in another — independent.

---

## RLS scoping — who sees what

**Tee-time read policy.** A user sees all public posts + group posts for groups they're an active member of. Enforced at the DB, not the client — a user can't query another group's private tee times by hitting the API directly.

```sql
visibility = 'public'
OR group_id IN (
  SELECT group_id FROM group_members
  WHERE user_id = auth.uid() AND status = 'active'
)
```

**Group-member write policy.** A group_admin can manage members only in groups where they hold that role.

```sql
group_id IN (
  SELECT group_id FROM group_members
  WHERE user_id = auth.uid()
    AND role = 'group_admin'
    AND status = 'active'
)
```

super_admin (Rico) bypasses and sees/manages all.

---

## Membership flow (approval-gated group, e.g. women's club)

1. User hits the group's invite link/slug -> `group_members` row created with `status='pending'`.
2. Group admin sees pending list -> approves -> `status='active'`.
3. Group-scoped tee times become mutually visible.

Club owns the gate; ForeSome owns the container. You never have to vet who qualifies — the group admin does.

---

## Feed principle

A user belongs to multiple groups + the public pool at once. The main feed is a **union** — public + every group they're in — with a filter to narrow to one group. Filter chips come from the user's **memberships**, not from tee-time rows, so a group with zero open posts still shows (reads as "quiet," not missing).

Reference implementations: `useFeed.js`, `FeedScreen.jsx`, `GroupAdminPanel.jsx`.
