# HOCKIA - Supabase Backend

## Project Information

- **Project Name:** HOCKIA
- **Project ID:** xtertgftujnebubxgqit
- **Project URL:** https://xtertgftujnebubxgqit.supabase.co
- **Region:** East US (North Virginia)

## Connection Status

✅ Successfully connected to remote Supabase project!

## Project Structure

```
.
├── .env                    # Environment variables (DO NOT COMMIT)
├── .gitignore             # Git ignore rules
├── supabase/
│   ├── config.toml        # Supabase configuration
│   └── .temp/             # Temporary CLI files
└── README.md              # This file
```

## Environment Variables

All credentials are stored in `.env` file:

- `SUPABASE_URL` - Your project's API URL
- `SUPABASE_ANON_KEY` - Public anonymous key (safe for client-side)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-side only, keep secret!)
- `SUPABASE_DB_PASSWORD` - Database password
- `SUPABASE_ACCESS_TOKEN` - CLI access token

## Common Supabase CLI Commands

### Authentication & Project Management

```bash
# Set access token for CLI operations
export SUPABASE_ACCESS_TOKEN=your_supabase_access_token

# List all your projects
supabase projects list

# Check link status
cat supabase/.temp/project-ref
```

### Database Management

```bash
# Connect to remote database via psql
supabase db remote commit

# Generate TypeScript types from your database
supabase gen types typescript --linked > types/supabase.ts

# Create a new migration
supabase migration new migration_name

# Push migrations to remote
supabase db push
```

### Functions & Edge Functions

```bash
# Create a new Edge Function
supabase functions new function_name

# Deploy Edge Function
supabase functions deploy function_name

# List all functions
supabase functions list
```

### Migrations

```bash
# Create a new migration file
supabase migration new your_migration_name

# List all migrations
supabase migration list

# Repair migration history
supabase migration repair --status applied
```

## Working with the Remote Database

Since you're connected to a remote project, you don't need Docker for most operations. Use these commands to interact with your production database:

```bash
# View database diff (requires Docker for shadow database)
supabase db diff

# Execute SQL directly
supabase db execute --sql "SELECT * FROM your_table LIMIT 10"
```

## Security Notes

⚠️ **IMPORTANT:**
- Never commit `.env` file to version control
- Keep your `SUPABASE_SERVICE_ROLE_KEY` secret
- Use `SUPABASE_ANON_KEY` for client-side applications
- The `.gitignore` file is configured to exclude sensitive files

## Next Steps

1. **Create migrations** - Use `supabase migration new` to create database schema changes
2. **Generate types** - Run type generation for TypeScript projects
3. **Deploy functions** - Create and deploy Edge Functions as needed
4. **Test locally** - (Optional) Install Docker to run local Supabase stack

## Troubleshooting

### Docker not required
Most remote operations don't require Docker. You only need it for:
- Running local Supabase stack (`supabase start`)
- Using `supabase db pull` (creates shadow database)
- Local development/testing

### Access Token
If commands fail with authentication errors, make sure to export the access token:
```bash
export SUPABASE_ACCESS_TOKEN=your_supabase_access_token
```

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)
- [Database Migrations](https://supabase.com/docs/guides/cli/managing-database-migrations)
- [Edge Functions](https://supabase.com/docs/guides/functions)

---

**Project linked and ready for development! 🚀**
