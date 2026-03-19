#!/usr/bin/env bash
# Sequentially apply Supabase SQL setup files for HOCKIA

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install via https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

FILES=(
  "001_initial_schema.sql"
  "002_functions_and_triggers.sql"
  "003_rls_policies.sql"
  "004_indexes_views.sql"
  "005_storage.sql"
  "006_friends.sql"
  "007_notifications.sql"
)

for file in "${FILES[@]}"; do
  echo "Applying ${file}..."
  supabase db execute --file "${SCRIPT_DIR}/${file}"
  echo "Done ${file}."
  echo
  sleep 1
done

echo "All Supabase migrations applied."