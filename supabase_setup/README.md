# Supabase Setup Guide

This folder consolidates everything needed to recreate the HOCKIA backend on a new Supabase project. Apply the SQL files in order, then complete the manual dashboard steps below to finish configuration.

## Prerequisites
- Supabase CLI v1.177.3 or newer (`brew install supabase/tap/supabase` on macOS).
- Logged into Supabase CLI (`supabase login`).
- Local workspace linked to the target Supabase project (`supabase link --project-ref <new-project-ref>` run from the repo root).
- `.env.local` already populated with your new `SUPABASE_URL` and `SUPABASE_ANON_KEY` (done earlier in this project).

## Apply the SQL migrations
Run everything from the repository root (`/Users/tianurien/Desktop/Code/HOCKIA`).

### Option A – one command
```bash
chmod +x supabase_setup/run_all.sh
supabase_setup/run_all.sh
```

### Option B – manual execution
```bash
supabase db execute --file supabase_setup/001_initial_schema.sql
supabase db execute --file supabase_setup/002_functions_and_triggers.sql
supabase db execute --file supabase_setup/003_rls_policies.sql
supabase db execute --file supabase_setup/004_indexes_views.sql
supabase db execute --file supabase_setup/005_storage.sql
```

Each script is idempotent; rerunning is safe if something fails mid-way.

## Manual dashboard configuration
Perform these steps inside the Supabase dashboard after the SQL finishes.

1. **Authentication → URL Configuration**
   - Site URL: `https://inhockia.com`
   - Additional Redirect URLs: `http://localhost:5173/auth/callback`, `https://inhockia.com/auth/callback`
   - Enable email confirmations (already default) because the app relies on PKCE verification.

2. **Authentication → Providers**
   - Keep Email provider enabled; others remain disabled unless you plan to support them.

3. **Authentication → Policies**
   - Confirm “Enable email confirmations” is toggled on.
   - Optional: configure custom email templates to match branding if desired.

4. **Database → SQL Editor**
   - Run `ANALYZE` if you imported data manually (helps query planner):
     ```sql
     ANALYZE public.profiles;
     ANALYZE public.vacancies;
     ANALYZE public.vacancy_applications;
     ANALYZE public.conversations;
     ANALYZE public.messages;
     ```

5. **Storage → Settings**
   - Confirm Image Transformations are enabled if you plan to offload resizing to Supabase (optional, but recommended for gallery performance).

6. **Storage → Buckets**
   - Buckets `avatars`, `gallery`, `club-media`, and `player-media` now exist. Validate that each bucket shows as **Public** and that policies were created by the SQL scripts. No further action required unless you need custom caching headers.

7. **Edge Functions**
   - Deploy the delete-account function once Supabase CLI is linked:
     ```bash
     supabase functions deploy delete-account --project-ref <new-project-ref>
     ```
   - In the function environment variables (Dashboard → Functions → delete-account → Settings) add:
       - `SUPABASE_URL` – <your-supabase-project-url>
       - `SUPABASE_SERVICE_ROLE_KEY` – <your-supabase-service-role-key>

    Notes:
    - Do not paste keys into this repo/docs. Store them in Supabase function env vars (or your secret manager).
    - Use the **service role** key here (server-side only). Do not use the anon/public key for admin Edge Functions.

8. **Authentication → Webhooks (Optional but recommended)**
   - If you plan to auto-create profiles when a user verifies email, configure a webhook pointing to a serverless worker (or reuse the existing automation) that calls `create_profile_for_new_user`.

## Post-setup tasks
- Regenerate local TypeScript types so `client/src/lib/database.types.ts` aligns with the freshly created schema:
  ```bash
  supabase gen types typescript --linked --schema public \
    > client/src/lib/database.types.ts
  ```
  (Commit the updated file if it changes.)

- Restart Vite after applying migrations so cached RPC metadata resets.

- Run through the onboarding flow end-to-end:
  1. Sign up as player/coach/club.
  2. Complete onboarding → ensure profile appears on Community page.
  3. Create a vacancy, apply from a player account, verify Messaging badge updates.

- Test the delete-account flow once to confirm new buckets/tables are covered.

## Known follow-ups / sanity checks
- The `delete-account` edge function still references `player_media` table and `playing_history.player_id`. In the current schema those resources are represented by `gallery_photos` (`user_id`) and `playing_history.user_id`. Update the function to match the new column names (or simplify it by relying on cascade deletes now provided in the SQL).
- If you import legacy data, make sure `onboarding_completed` is set appropriately so Community listings remain accurate.
- Should you introduce additional media buckets, copy the policy patterns from `005_storage.sql` to keep permissions tight.

Everything above ties the frontend back to Supabase using the new project credentials added earlier. Once you finish the manual steps, the application should function against the freshly provisioned backend.
