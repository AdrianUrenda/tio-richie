# Tío Richie — Behavioral Finance Coach for Mexico

## About

Chat-first web app for middle-income Mexicans (MXN $25k–$80k/month).
AI coach powered by Claude API + bank data via Finerio Connect.
MXN $99/month subscription with 30-day free trial.

**Stage:** Pre-MVP (planning/documentation phase — no implementation code yet).

## Repository Structure

```
tio-richie/
├── CLAUDE.md                                # Project instructions for AI assistants
├── TioRichie_MVP_PRD.docx                   # Full MVP Product Requirements Document
├── M1_TioRichie_or_AdrianUrenda v2.pdf      # Problem definition & market research (SCARE model)
├── M2_TioRichie_or_AdrianUrenda.pdf         # Competitive landscape analysis (12 competitors)
├── M3_TioRichie_or_Adrian Urenda.xlsx       # Customer discovery (12 interviews)
└── .git/
```

No source code, configuration files, or package.json exist yet. The repository currently contains only strategic documentation.

## Planned Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js (React), TypeScript, Tailwind CSS | Chat UI, onboarding, settings |
| Backend | Node.js (Fastify or Express), TypeScript | API, business logic, financial engine |
| Database | PostgreSQL (managed) | Users, transactions, goals, budgets |
| Cache | Redis | Sessions, safe-to-spend cache, rate limiting |
| Object Storage | S3-compatible | CSV uploads, data exports |
| LLM | Anthropic Claude API (Sonnet) | Conversational coaching |
| Bank Data | Finerio Connect API | Account aggregation, transactions |
| Payments | Stripe | Subscriptions (MXN $99/mo), OXXO support |
| CI/CD | GitHub Actions | Testing, deployment |
| Monitoring | Sentry + Datadog (or equivalent) | Errors, performance, uptime |

## Architecture Principles

- **Chat-first UI**: Full-screen, mobile-first chat is the primary interface — not dashboards or forms
- **Deterministic financial calculations**: All math (safe-to-spend, debt projections, budgets) runs on the backend, never the LLM
- **LLM for coaching only**: Claude handles natural language, tone, and conversational flow — it references pre-calculated numbers, never computes them
- **LLM orchestration pattern**: Frontend → Backend API → context assembly → Claude API → guardrail validation → streamed response to user
- **Finerio handles credentials**: Tío Richie never stores bank passwords; Finerio Connect manages tokenized access
- **Privacy by design**: Minimal PII collection, AES-256 at rest, TLS 1.3 in transit, LFPDPPP compliance

## Core Data Model

| Entity | Purpose |
|--------|---------|
| `User` | Identity, auth, subscription status, notification prefs |
| `BankConnection` | Finerio connection per bank, sync status |
| `Account` | Checking/savings/credit accounts from Finerio or CSV |
| `Transaction` | Financial transactions with AI-assigned categories (user-correctable) |
| `Goal` | Debt payoff, emergency fund, retirement, big purchase — with targets and progress |
| `Budget` | Monthly/quincena budgets by category, AI-generated and user-adjustable |
| `Conversation` | Chat history (last 20 messages sent to LLM, older summarized) |
| `Notification` | Push notification tracking (delivery, opens) |
| `Subscription` | Stripe subscription state, trial dates, billing |

## Key Features (MVP Scope)

1. **Onboarding**: Bank connection (Finerio widget) or CSV upload fallback → financial snapshot → goal setting → first chat
2. **Chat experience**: Persistent full-screen chat with safe-to-spend display, context-aware Claude responses, quick-action buttons
3. **Financial intelligence**: Transaction categorization, income/expense detection, daily safe-to-spend, budget generation, debt analysis (avalanche/snowball), goal tracking
4. **Proactive nudges**: Spending alerts, payment reminders, quincena check-ins, goal milestones, inactivity re-engagement (via web push)
5. **Subscription**: 30-day free trial → MXN $99/month via Stripe (cards + OXXO)

## Safe-to-Spend Formula

```
Safe-to-Spend Today = (Remaining Disposable Income − Committed Upcoming Expenses − Goal Contributions Due) / Remaining Days in Period
```

- Resets each payday (quincena-aware: 1st and 15th)
- Updates with every new transaction
- Triggers spending alerts when exceeded

## AI Persona: Tío Richie

- **Archetype**: Wise, warm Mexican uncle who is good with money — tells it straight but never makes you feel stupid
- **Tone**: Warm, direct, supportive, occasionally humorous. Uses "tú" (informal). Natural Mexican expressions (quincena, no manches, va que va)
- **Language**: Spanish (Mexican) only. No Spanglish unless user initiates. Explains financial jargon on first use
- **Address**: Calls user "sobrino/sobrina" naturally, alternating with their first name
- **Boundaries**: Coach, not financial advisor. No specific security/product recommendations. No medical, legal, or tax advice. Clear disclaimers on investments/retirement

### LLM Guardrails

- No fabricated numbers — all figures come from backend, LLM references them verbatim
- No specific investment recommendations — redirects to licensed advisors
- No medical, legal, or tax advice — redirects to professionals
- Character consistency enforced via system prompt examples
- Emotional safety: empathetic response + professional resource suggestions if user expresses distress
- Backend validation layer checks responses before delivery

## Code Style (for implementation)

- TypeScript strict mode
- ES modules (`import`/`export`)
- Functional React components with hooks
- Tailwind for styling — no separate CSS files
- All user-facing text in Spanish (Mexican)
- Mobile-first responsive design (375px–428px primary, desktop secondary)
- WCAG 2.1 AA accessibility compliance

## Commands (planned)

```bash
npm run dev     # Start dev server
npm run test    # Run tests
npm run lint    # Lint check
```

## Key Documentation

| Document | Contents |
|----------|----------|
| `TioRichie_MVP_PRD.docx` | Full MVP PRD: functional requirements (FR-100 through FR-706), non-functional requirements, architecture, data model, AI spec, analytics events, risks, 24-week roadmap |
| `M1_TioRichie_or_AdrianUrenda v2.pdf` | Problem definition: SCARE analysis, market sizing (TAM 33M, SAM 15M, SOM 10M), behavioral trap cycle, quincena dynamics |
| `M2_TioRichie_or_AdrianUrenda.pdf` | Competitive landscape: Cleo, YNAB, Rocket Money, Fintonic, Fintual, Hey Banco, Klar, NuBank, Finerio, BBVA |
| `M3_TioRichie_or_Adrian Urenda.xlsx` | Customer discovery: 12 structured interviews with target segment |

## Target Users

- **Daniela Torres** (34, Querétaro): Sales executive, MXN $45k/mo, revolving credit card debt, wants to pay off debt and save for a home without sacrificing lifestyle
- **Alejandro Ruiz** (42, Monterrey): Family man, MXN $75k/mo household, mortgage + car loan, wants emergency fund, college savings, and to start investing beyond AFORE/CETES

## Business Context

- **Target market**: Formally employed, banked, digitally active Mexicans aged 25–45, income deciles 7–9
- **Core insight**: 77% believe they manage money well, but only 31% save and <12% invest — the gap is behavioral (execution), not informational
- **Annual cost of inaction**: MXN $30k–$55k per household in interest, fees, and impulse spending
- **Quincena cycle**: 24x/year boom-bust pattern where users run out of cash by day 9–10

## Development Phases (from PRD)

| Phase | Focus |
|-------|-------|
| Phase 0 (Weeks 1–4) | Foundation: architecture, CI/CD, DB schema, auth, Finerio sandbox, Claude prototype |
| Phase 1 (Weeks 5–8) | Core chat: UI, Claude integration with persona, basic conversation, onboarding |
| Phase 2 (Weeks 9–12) | Financial intelligence: Finerio production, transactions, CSV, safe-to-spend, budgets, goals |
| Phase 3 (Weeks 13–16) | Behavioral layer: notifications, spending alerts, debt planning, quincena check-ins, guardrails |
| Phase 4 (Weeks 17–20) | Monetization: Stripe, trial management, settings, performance, security |
| Phase 5 (Weeks 21–22) | Closed beta (50–100 users) |
| Phase 6 (Weeks 23–24) | Public launch |

## Non-Functional Targets

- Chat response: <3s first token, <8s full response (streaming)
- Page load: <2s on 4G
- Safe-to-spend update: within 5 minutes of new transaction
- Bank sync: every 6 hours + manual refresh
- Uptime: 99.5%
- MVP scale: 500 concurrent sessions, up to 1,000 users
- LLM cost: ~$0.003–$0.01 per message; rate limit 60 messages/user/hour

## Notes for AI Assistants

- **Language**: All user-facing content must be in Mexican Spanish. Code comments and technical docs may be in English.
- **Financial math**: Never use the LLM for calculations. Implement deterministic backend functions for safe-to-spend, debt projections, budget tracking, and goal progress.
- **Finerio**: Bank credential handling is entirely Finerio's responsibility. Never implement credential storage.
- **Privacy**: Follow LFPDPPP requirements. Support ARCO rights (access, rectification, cancellation, opposition). Encrypt PII at rest.
- **LLM context**: Send structured financial summaries to Claude, not raw transaction data. Minimize PII in prompts.
- **Regulatory**: Tío Richie is a coaching tool, not a regulated financial advisor. All user-facing language must include appropriate disclaimers.
