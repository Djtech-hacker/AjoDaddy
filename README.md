# PayPaddy — African Fintech Contribution Platform

> A production-grade digital Ajo/Esusu platform. Real backend. Real payments. Real-time.

---

## Stack

| Layer       | Technology                                                        |
|-------------|-------------------------------------------------------------------|
| Frontend    | React 18, TypeScript, TailwindCSS, Framer Motion, TanStack Query |
| Backend     | NestJS, TypeScript, Prisma ORM                                    |
| Database    | PostgreSQL (Supabase)                                             |
| Realtime    | Socket.io                                                         |
| Payments    | Paystack, Flutterwave                                             |
| Files       | Cloudinary                                                        |
| Email       | Resend                                                            |
| Cache       | Redis (Upstash)                                                   |
| Frontend CD | Vercel                                                            |
| Backend CD  | Railway                                                           |

---

## Project Structure

```
paypaddy-v2/
├── backend/                 # NestJS API
│   ├── src/
│   │   ├── auth/            # JWT auth, refresh tokens, Google OAuth
│   │   ├── users/           # Profiles, avatars, reputation, badges
│   │   ├── groups/          # Ajo group management, cycles, invites
│   │   ├── contributions/   # Contribution engine, cron jobs
│   │   ├── wallet/          # Atomic wallet operations
│   │   ├── payments/        # Paystack + Flutterwave + webhooks
│   │   ├── notifications/   # In-app + email via Resend
│   │   ├── chat/            # Socket.io real-time chat
│   │   ├── analytics/       # Dashboard queries, smart insights
│   │   ├── admin/           # Super-admin panel, fraud, audit
│   │   ├── prisma/          # Prisma service
│   │   └── config/          # App config, env validation
│   └── prisma/
│       └── schema.prisma    # Full database schema
└── frontend/                # React app
    └── src/
        ├── api/             # All API service functions
        ├── components/      # UI primitives, layout, dashboard
        ├── hooks/           # TanStack Query hooks for every endpoint
        ├── lib/             # Axios client, Socket.io singleton
        ├── pages/           # All pages (auth, dashboard, groups, wallet)
        ├── stores/          # Zustand stores (auth, UI)
        └── types/           # Shared TypeScript types
```

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-org/paypaddy-v2
cd paypaddy-v2

# Install backend deps
cd backend && npm install

# Install frontend deps
cd ../frontend && npm install
```

### 2. Configure environment

```bash
# Root
cp .env.example .env

# Frontend
cd frontend && cp .env.example .env

# Fill in all values — see .env.example for descriptions
```

### 3. Set up database

```bash
cd backend

# Generate Prisma client
npx prisma generate

# Run migrations (creates all tables)
npx prisma migrate dev --name init

# Optional: open Prisma Studio
npx prisma studio
```

### 4. Start development servers

```bash
# Backend (from /backend)
npm run start:dev

# Frontend (from /frontend)
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000/api
- API docs (Swagger): http://localhost:4000/api/docs

---

## Environment Variables

All required env vars are documented in `.env.example`.

### Required services to configure:

| Service      | Where to get credentials                              |
|--------------|-------------------------------------------------------|
| PostgreSQL   | [Supabase](https://supabase.com) — free tier          |
| Redis        | [Upstash](https://upstash.com) — free tier            |
| Paystack     | [Paystack Dashboard](https://dashboard.paystack.com)  |
| Flutterwave  | [Flutterwave Dashboard](https://app.flutterwave.com)  |
| Cloudinary   | [Cloudinary Console](https://cloudinary.com)          |
| Resend       | [Resend Dashboard](https://resend.com)                |

---

## Deployment

### Backend → Railway

```bash
cd backend

# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set all env vars in the Railway dashboard under **Variables**.

The `railway.toml` already configures build and start commands:
- Build: `npm install && npx prisma generate && npm run build`
- Start: `npx prisma migrate deploy && node dist/main`

### Frontend → Vercel

```bash
cd frontend

# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

Set `VITE_API_URL` and `VITE_WS_URL` in Vercel project settings → Environment Variables.

---

## API Documentation

Swagger UI is available at `/api/docs` in development.

### Core endpoints

```
POST   /api/auth/register          Register new user
POST   /api/auth/login             Login, returns access token
POST   /api/auth/refresh           Refresh access token (uses httpOnly cookie)
POST   /api/auth/logout            Revoke tokens

GET    /api/analytics/summary      Full dashboard summary
GET    /api/analytics/insights     AI-lite smart insights

GET    /api/groups                 List groups
POST   /api/groups                 Create group
GET    /api/groups/:slug           Group detail
POST   /api/groups/:id/join        Join group

POST   /api/contributions/pay      Make contribution from wallet
GET    /api/contributions          Contribution history

GET    /api/wallet                 Wallet balance
GET    /api/wallet/transactions    Transaction history

POST   /api/payments/initiate      Initiate Paystack/Flutterwave payment
POST   /api/payments/verify        Verify payment after redirect
POST   /api/payments/webhook/paystack     Paystack webhook
POST   /api/payments/webhook/flutterwave  Flutterwave webhook

GET    /api/notifications          List notifications
PATCH  /api/notifications/read-all Mark all as read

GET    /api/chat/:groupId/messages  Chat history (paginated)
WS     /ws                          Socket.io real-time
```

---

## Socket.io Events

### Client → Server
| Event           | Payload                            | Description              |
|-----------------|------------------------------------|--------------------------|
| `join_group`    | `{ groupId }`                      | Join group chat room     |
| `leave_group`   | `{ groupId }`                      | Leave group room         |
| `send_message`  | `{ groupId, content, type }`       | Send chat message        |
| `typing_start`  | `{ groupId, username }`            | Show typing indicator    |
| `typing_stop`   | `{ groupId }`                      | Hide typing indicator    |

### Server → Client
| Event                | Payload           | Description                     |
|----------------------|-------------------|---------------------------------|
| `new_message`        | ChatMessage       | New chat message in group       |
| `notification`       | Notification      | Real-time notification          |
| `contribution_update`| data              | Someone just contributed        |
| `payout_update`      | data              | Payout status changed           |
| `user_typing`        | `{ username }`    | User is typing                  |
| `user_stop_typing`   | `{ userId }`      | User stopped typing             |

---

## Security Features

- ✅ JWT access tokens (15m expiry) + refresh tokens (7d, httpOnly cookie)
- ✅ Token rotation on refresh
- ✅ Argon2id password hashing
- ✅ Rate limiting (per-route, Redis-backed)
- ✅ Helmet.js security headers
- ✅ CORS with origin whitelist
- ✅ Class-validator input validation + whitelist
- ✅ Webhook signature verification (Paystack + Flutterwave)
- ✅ Atomic database transactions for all financial operations
- ✅ Overdraft protection on wallet
- ✅ Transaction PIN for sensitive operations
- ✅ RBAC (User / Admin / Super Admin)
- ✅ Audit logging for all admin actions
- ✅ Login attempt tracking
- ✅ Session management with device tracking
- ✅ SQL injection prevention via Prisma parameterized queries

---

## License

Private — PayPaddy Technologies Ltd © 2025
#   A j o D a d d y  
 