#!/bin/bash
# =============================================================================
# PLAYR: Deploy to Staging Script
# =============================================================================
# This script deploys database migrations and edge functions to staging
# for testing before production promotion.
#
# Usage:
#   ./scripts/deploy-to-staging.sh [--db-only] [--functions-only]
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

STAGING_REF="ivjkdaylalhsteyyclvl"
PRODUCTION_REF="xtertgftujnebubxgqit"

# Parse arguments
DB_ONLY=false
FUNCTIONS_ONLY=false

for arg in "$@"; do
  case $arg in
    --db-only)
      DB_ONLY=true
      shift
      ;;
    --functions-only)
      FUNCTIONS_ONLY=true
      shift
      ;;
  esac
done

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

deploy_all_functions() {
  local function_dir
  local function_name
  local config_file

  while IFS= read -r function_dir; do
    function_name=$(basename "$function_dir")
    config_file="$function_dir/config.toml"

    if [ -f "$config_file" ] && grep -q "verify_jwt = false" "$config_file"; then
      log_info "Deploying $function_name with JWT verification disabled..."
      supabase functions deploy "$function_name" --no-verify-jwt
    else
      log_info "Deploying $function_name..."
      supabase functions deploy "$function_name"
    fi
  done < <(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name "_shared" | sort)
}

# Check we're in the right directory
if [ ! -f "supabase/config.toml" ]; then
  log_error "Must run from PLAYR repository root"
  exit 1
fi

# Store original project
ORIGINAL_PROJECT=""
if [ -f "supabase/.temp/project-ref" ]; then
  ORIGINAL_PROJECT=$(cat supabase/.temp/project-ref)
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Deploying to Staging${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Link to staging
log_info "Linking to staging..."
supabase unlink 2>/dev/null || true
supabase link --project-ref "$STAGING_REF"
log_success "Linked to staging ($STAGING_REF)"

# Push migrations
if [ "$FUNCTIONS_ONLY" = false ]; then
  log_info "Pushing database migrations..."
  if supabase db push; then
    log_success "Migrations applied"
  else
    log_error "Migration failed!"
    exit 1
  fi
fi

# Deploy functions
if [ "$DB_ONLY" = false ]; then
  log_info "Deploying edge functions..."
  if deploy_all_functions; then
    log_success "Functions deployed"
  else
    log_error "Function deployment failed!"
    exit 1
  fi
fi

# Show status
echo ""
log_info "Staging edge functions:"
supabase functions list | head -15

# Restore original link if it was production
if [ "$ORIGINAL_PROJECT" = "$PRODUCTION_REF" ]; then
  log_info "Restoring link to production..."
  supabase unlink 2>/dev/null || true
  supabase link --project-ref "$PRODUCTION_REF"
  log_success "Restored link to production"
fi

echo ""
log_success "Staging deployment complete!"
echo ""
echo "  🔗 Staging Dashboard: https://supabase.com/dashboard/project/$STAGING_REF"
echo "  🌐 Preview Site:      https://playr-staging.vercel.app"
echo ""
echo "  Next steps:"
echo "    1. Test on Preview deployment"
echo "    2. Run E2E tests: npm run test:e2e:smoke"
echo "    3. When ready: ./scripts/promote-to-production.sh"
echo ""
