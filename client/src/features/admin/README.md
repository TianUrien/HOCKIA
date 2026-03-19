# HOCKIA Admin Portal

Internal admin portal for managing HOCKIA users, data issues, and platform operations.

## Overview

The admin portal is accessible at `/admin` and provides:

- **Dashboard Overview** - Key metrics, signup trends, top countries
- **User Directory** - Search, filter, and manage all users
- **Data Issues** - Find and fix orphaned records, broken references
- **Audit Log** - Track all admin actions indefinitely
- **Settings** - Admin portal configuration

## Access Control

Admin access is controlled via `app_metadata.is_admin` JWT claim:

1. Open Supabase Dashboard → Authentication → Users
2. Find your user and click to edit
3. In "User Metadata" section, add to `app_metadata`:
   ```json
   { "is_admin": true }
   ```
4. Sign out and back in to refresh your JWT

The existing `is_platform_admin()` function checks this claim.

## Deployment

### 1. Run Database Migrations

```bash
cd /path/to/HOCKIA

# Push migrations to Supabase
supabase db push

# Or run specific migrations
supabase migration up --include-all
```

The migrations will:
- Add `is_blocked`, `blocked_at`, `blocked_reason` columns to `profiles`
- Create `admin_audit_logs` table
- Create all `admin_*` RPC functions

### 2. Deploy Edge Function

```bash
# Deploy the admin-actions Edge Function
supabase functions deploy admin-actions
```

### 3. Regenerate TypeScript Types

```bash
# Generate fresh types including admin functions
supabase gen types typescript --project-id YOUR_PROJECT_ID > client/src/types/supabase.ts
```

After regenerating, you can simplify `adminApi.ts` to use direct `supabase.rpc()` calls.

### 4. Deploy Frontend

The admin routes are lazy-loaded and included in the main client bundle:

```bash
cd client
npm run build
# Deploy to Vercel or your hosting
```

## File Structure

```
client/src/features/admin/
├── index.ts                  # Feature barrel export
├── types.ts                  # TypeScript interfaces
├── api/
│   └── adminApi.ts           # RPC & Edge Function calls
├── hooks/
│   ├── index.ts
│   ├── useAdmin.ts           # Admin auth state
│   ├── useAdminStats.ts      # Dashboard stats
│   └── useDataIssues.ts      # Orphans & broken refs
├── components/
│   ├── index.ts
│   ├── AdminGuard.tsx        # Route protection
│   ├── AdminLayout.tsx       # Layout with sidebar
│   ├── StatCard.tsx          # Metric display
│   ├── DataTable.tsx         # Reusable table
│   └── ConfirmDialog.tsx     # Confirmation modal
└── pages/
    ├── index.ts
    ├── AdminOverview.tsx     # Dashboard
    ├── AdminDirectory.tsx    # User search/manage
    ├── AdminDataIssues.tsx   # Orphans & refs
    ├── AdminAuditLog.tsx     # Action history
    └── AdminSettings.tsx     # Configuration

supabase/
├── migrations/
│   ├── 202512091300_admin_portal_schema.sql
│   └── 202512091301_admin_rpc_functions.sql
└── functions/
    └── admin-actions/
        └── index.ts          # Delete auth users
```

## Admin Actions

| Action | Function | Description |
|--------|----------|-------------|
| Block User | `admin_block_user` | Prevents login, logs action |
| Unblock User | `admin_unblock_user` | Restores access |
| Set Test Account | `admin_set_test_account` | Mark for filtering |
| Update Profile | `admin_update_profile` | Modify any field |
| Delete Auth User | Edge Function | Remove from auth.users |
| Delete Orphan Profile | `admin_delete_orphan_profile` | Clean up orphaned profile |

## Audit Logging

All admin actions are logged to `admin_audit_logs`:

- `action` - What was done (block_user, update_profile, etc.)
- `target_type` - What type (profile, auth_user, etc.)
- `target_id` - ID of affected record
- `details` - JSON with before/after or parameters
- `created_at` - Timestamp

Logs are retained indefinitely (no automatic pruning).

## Security Notes

1. **RPC Functions** use `SECURITY DEFINER` with `admin_require_admin()` check
2. **Edge Function** verifies JWT and checks `app_metadata.is_admin`
3. **RLS Policies** on `admin_audit_logs` allow admin read, no direct writes
4. **Frontend** uses `AdminGuard` component for route protection
5. **Actions** are logged before execution for accountability

## Development

```bash
# Start local Supabase
supabase start

# Run client dev server
cd client && npm run dev

# Access admin at http://localhost:5173/admin
```

Make sure to set your local user's `app_metadata.is_admin = true` in the local Supabase Auth dashboard.
