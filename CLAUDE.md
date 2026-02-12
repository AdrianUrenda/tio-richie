# Tío Richie — Behavioral Finance Coach for Mexico

## About
Chat-first web app for middle-income Mexicans (MXN $25k–$80k/month). 
AI coach powered by Claude API + bank data via Finerio Connect. 
MXN $99/month subscription with 30-day free trial.

## Tech Stack
- Frontend: Next.js (React), TypeScript, Tailwind CSS
- Backend: Node.js (Fastify or Express)
- Database: PostgreSQL
- Cache: Redis
- LLM: Anthropic Claude API (Sonnet)
- Bank data: Finerio Connect API
- Payments: Stripe
- Language: Spanish (Mexican) only

## Key Docs
- Full PRD: @docs/PRD.md
- Problem definition: @docs/M1_problem.pdf

## Architecture
- Chat UI is the primary interface (full-screen, mobile-first)
- All financial calculations are deterministic (backend), never LLM
- LLM is for natural language coaching only
- Finerio handles bank credentials (we never store them)

## Code Style
- TypeScript strict mode
- ES modules (import/export)
- Functional React components with hooks
- Tailwind for styling, no separate CSS files

## Commands
- `npm run dev`: Start dev server
- `npm run test`: Run tests
- `npm run lint`: Lint check
