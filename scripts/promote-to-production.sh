#!/bin/bash
# =============================================================================
# PLAYR: Staging → Production Promotion Script
# =============================================================================
# This script safely promotes database migrations and edge functions from
# staging to production with built-in safety checks.
#
# Usage:
#   ./scripts/promote-to-production.sh [--skip-confirmation] [--db-only] [--functions-only]
#
# Options:
#   --skip-confirmation  Skip interactive confirmations (for CI/CD)
#   --db-only           Only push database migrations
#   --functions-only    Only deploy edge functions
#   --dry-run           Show what would be done without executing
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project references
STAGING_REF="ivjkdaylalhsteyyclvl"
PRODUCTION_REF="xtertgftujnebubxgqit"

# Parse arguments
SKIP_CONFIRMATION=false
DB_ONLY=false
FUNCTIONS_ONLY=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --skip-confirmation)
      SKIP_CONFIRMATION=true
      shift
      ;;
    --db-only)
      DB_ONLY=true
      shift
      ;;
    --functions-only)
      FUNCTIONS_ONLY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      ;;
  esac
done

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

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

log_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

confirm() {
  if [ "$SKIP_CONFIRMATION" = true ]; then
    return 0
  fi
  
  read -p "$(echo -e "${YELLOW}?${NC} $1 [y/N] ")" -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "Aborted by user"
    exit 1
  fi
}

check_command() {
  if ! command -v "$1" &> /dev/null; then
    log_error "$1 is required but not installed."
    exit 1
  fi
}

get_current_project() {
  if [ -f "supabase/.temp/project-ref" ]; then
    cat supabase/.temp/project-ref
  else
    echo "none"
  fi
}

# =============================================================================
# Pre-flight Checks
# =============================================================================

log_header "Pre-flight Checks"

# Check required commands
check_command "supabase"
check_command "git"
log_success "Required commands available"

# Check we're in the right directory
if [ ! -f "supabase/config.toml" ]; then
  log_error "Must run from PLAYR repository root (supabase/config.toml not found)"
  exit 1
fi
log_success "Running from repository root"

# Check git status
if [ -n "$(git status --porcelain)" ]; then
  log_warning "You have uncommitted changes:"
  git status --short
  confirm "Continue with uncommitted changes?"
fi

# Check current branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  log_warning "You are on branch '$CURRENT_BRANCH', not 'main'"
  confirm "Continue on non-main branch?"
fi
log_success "Git status verified"

# Store original project link
ORIGINAL_PROJECT=$(get_current_project)
log_info "Currently linked to: $ORIGINAL_PROJECT"

# =============================================================================
# Staging Verification
# =============================================================================

log_header "Staging Verification"

if [ "$DRY_RUN" = false ]; then
  log_info "Linking to staging to verify state..."
  supabase unlink 2>/dev/null || true
  supabase link --project-ref "$STAGING_REF"
  log_success "Linked to staging ($STAGING_REF)"

  # List functions on staging
  log_info "Edge functions on staging:"
  supabase functions list | head -20
  
  # Check secrets on staging
  log_info "Secrets configured on staging:"
  supabase secrets list
else
  log_info "[DRY RUN] Would link to staging and verify"
fi

confirm "Staging looks correct. Proceed with production promotion?"

# =============================================================================
# Database Migration Promotion
# =============================================================================

if [ "$FUNCTIONS_ONLY" = false ]; then
  log_header "Database Migration Promotion"
  
  if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would push migrations to production"
  else
    log_info "Linking to production..."
    supabase unlink 2>/dev/null || true
    supabase link --project-ref "$PRODUCTION_REF"
    log_success "Linked to production ($PRODUCTION_REF)"
    
    confirm "Push database migrations to PRODUCTION?"
    
    log_info "Pushing migrations..."
    if supabase db push; then
      log_success "Database migrations applied successfully"
    else
      log_error "Migration failed! Check output above."
      log_warning "Production may be in an inconsistent state."
      exit 1
    fi
  fi
fi

# =============================================================================
# Edge Function Deployment
# =============================================================================

if [ "$DB_ONLY" = false ]; then
  log_header "Edge Function Deployment"
  
  if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would deploy edge functions to production"
  else
    # Ensure we're linked to production
    CURRENT=$(get_current_project)
    if [ "$CURRENT" != "$PRODUCTION_REF" ]; then
      log_info "Linking to production..."
      supabase unlink 2>/dev/null || true
      supabase link --project-ref "$PRODUCTION_REF"
    fi
    
    confirm "Deploy edge functions to PRODUCTION?"
    
    log_info "Deploying all edge functions..."
    if deploy_all_functions; then
      log_success "Edge functions deployed successfully"
    else
      log_error "Function deployment failed! Check output above."
      exit 1
    fi
    
    # Verify deployment
    log_info "Verifying deployment..."
    supabase functions list
  fi
fi

# =============================================================================
# Post-Promotion Verification
# =============================================================================

log_header "Post-Promotion Verification"

if [ "$DRY_RUN" = false ]; then
  log_info "Production edge functions:"
  supabase functions list | grep -E "ACTIVE|NAME" || true
  
  log_info "Checking production secrets..."
  supabase secrets list
fi

# =============================================================================
# Restore Original Link (Optional)
# =============================================================================

log_header "Cleanup"

if [ "$ORIGINAL_PROJECT" = "$PRODUCTION_REF" ]; then
  log_info "Already linked to production (original state)"
else
  log_info "Original project was: $ORIGINAL_PROJECT"
  if [ "$SKIP_CONFIRMATION" = false ]; then
    read -p "$(echo -e "${YELLOW}?${NC} Restore link to $ORIGINAL_PROJECT? [Y/n] ")" -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      supabase unlink 2>/dev/null || true
      supabase link --project-ref "$ORIGINAL_PROJECT"
      log_success "Restored link to $ORIGINAL_PROJECT"
    fi
  fi
fi

# =============================================================================
# Summary
# =============================================================================

log_header "Promotion Complete"

echo ""
if [ "$DRY_RUN" = true ]; then
  log_warning "This was a DRY RUN - no changes were made"
else
  log_success "Production promotion completed successfully!"
  echo ""
  echo "  📦 Database migrations: $([ "$FUNCTIONS_ONLY" = true ] && echo "Skipped" || echo "Applied")"
  echo "  ⚡ Edge functions:      $([ "$DB_ONLY" = true ] && echo "Skipped" || echo "Deployed")"
  echo ""
  echo "  🔗 Production Dashboard: https://supabase.com/dashboard/project/$PRODUCTION_REF"
  echo "  🌐 Production Site:      https://oplayr.com"
  echo ""
  log_info "Remember to:"
  echo "    1. Monitor Sentry for new errors"
  echo "    2. Check Supabase Dashboard for query performance"
  echo "    3. Do a quick manual smoke test on https://oplayr.com"
fi
echo ""
