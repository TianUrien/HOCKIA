# HOCKIA - Field Hockey Professional Network

HOCKIA is the professional network for field hockey, connecting players, coaches, and clubs in a single platform.

## What HOCKIA Does

HOCKIA solves a fundamental problem in field hockey: **discovery and connection**.

- **Players** struggle to find opportunities (trials, contracts, positions) beyond their local network
- **Coaches** lack visibility into coaching positions available globally
- **Clubs** have difficulty discovering talent outside their immediate region

HOCKIA bridges these gaps by providing a centralized platform where all three stakeholder groups can connect professionally.

## Core Entities

### Profile
Every user has a profile with one of three roles:

| Role | Description | Key Features |
|------|-------------|--------------|
| **Player** | Field hockey players seeking opportunities | Position, playing history, availability status |
| **Coach** | Coaches seeking positions | Coaching experience, certifications |
| **Club** | Organizations posting opportunities | Club details, media, league information |

### Opportunity
An opportunity (job posting) created by a club, targeting either players or coaches:

- **Player Opportunities**: Positions for goalkeepers, defenders, midfielders, forwards
- **Coach Opportunities**: Coaching positions at various levels

### Application
When a player or coach applies to an opportunity:

- Application message explaining interest
- Status tracking (pending, shortlisted, rejected, withdrawn)
- Direct messaging between applicant and club

### Career History
Chronological timeline of a user's playing or coaching experience:

- Club name, position/role, dates
- League/division information
- Highlights and achievements

## User Flows

### 1. New User Onboarding
```
Sign Up → Select Role → Complete Profile → Browse/Post Opportunities
```

### 2. Player/Coach Applying to Opportunity
```
Browse Opportunities → Filter by Type/Location → View Details → Apply → Track Status
```

### 3. Club Posting Opportunity
```
Dashboard → Create Opportunity → Publish → Review Applications → Shortlist/Reject
```

### 4. Networking
```
View Profile → Send Friend Request → Direct Message → Build Connection
```

## Terminology Glossary

| Term | Definition |
|------|------------|
| **Opportunity** | A position posted by a club (formerly "vacancy") |
| **Application** | A submission from a player/coach to an opportunity |
| **Career History** | User's chronological experience timeline (formerly "playing history") |
| **Applicant** | The player or coach who applies (column: `applicant_id`) |
| **Profile Strength** | Percentage completion of a user's profile |
| **World Directory** | Global database of clubs for claiming/referencing |

## Technical Architecture

### Frontend
- **React 18** with TypeScript
- **Vite** for build tooling
- **TailwindCSS** for styling
- **React Query** for data fetching/caching
- **PWA** with offline support

### Backend
- **Supabase** for:
  - PostgreSQL database with Row Level Security (RLS)
  - Authentication (email, OAuth)
  - Real-time subscriptions
  - File storage
- **Edge Functions** (Deno/Hono) for:
  - Admin operations
  - Account deletion
  - Email notifications

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (all roles share one table) |
| `opportunities` | Job postings from clubs |
| `opportunity_applications` | Applications to opportunities |
| `career_history` | User experience timeline |
| `conversations` / `messages` | Direct messaging |
| `profile_comments` | Public comments on profiles |
| `profile_references` | Endorsements/references |

## Environment Setup

See [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) for detailed setup instructions.

### Quick Start
```bash
# Clone repository
git clone <repo-url>

# Install dependencies
cd client && npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Run development server
npm run dev
```

## Project Structure

```
/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Route pages
│   │   ├── features/      # Feature modules (admin, chat)
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Utilities, Supabase client, state
│   │   └── types/         # TypeScript type definitions
│   └── e2e/               # End-to-end tests
├── supabase/
│   ├── migrations/        # Database migrations
│   └── functions/         # Edge functions
└── docs/                  # Documentation
```

## Contributing

1. Create a feature branch from `main`
2. Make changes following existing patterns
3. Run `npm run typecheck` and `npm run lint`
4. Run `npm test` for unit tests
5. Run `npm run e2e` for end-to-end tests
6. Submit PR with clear description

## Support

- **Issues**: https://github.com/anthropics/claude-code/issues
- **Documentation**: See `/docs` folder
