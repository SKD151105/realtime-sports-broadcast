# Realtime Sports Broadcast

Realtime Sports Broadcast is a small full-stack project for live match cards, real-time commentary, and finished-match recaps. It includes an API, a WebSocket server for low-latency updates, and a Vite + React frontend.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-black?logo=express&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-Neon-4169E1?logo=postgresql&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle-ORM-0C0C0C)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-2F74C0)
![Vite + React](https://img.shields.io/badge/Vite-React-646CFF?logo=vite&logoColor=white)

## Overview

This repo is designed as a realistic real-time demo:

- REST API for matches, scores, and commentary
- WebSocket channel for push updates and subscriptions (`/ws`)
- Seed scripts for a “live demo loop” and finished-match recap backfills

## Low-latency note

On localhost, WebSocket round-trip time (RTT) is typically sub-millisecond. Using the included probe on a local setup, a sample run measured:

- Average RTT: ~0.71ms
- p95 RTT: ~1.19ms

These numbers are specific to local development (client and server on the same machine). Over Wi-Fi/LAN or a hosted environment, you should expect higher RTT.

## Project structure

```text
realtime-sports-broadcast/
├── src/                      # Express app + WebSocket server
│   ├── index.js              # Server entry point
│   ├── app.js                # Express app wiring
│   ├── ws/server.js          # WebSocket server (/ws)
│   ├── routes/               # REST routes
│   ├── controllers/          # HTTP handlers
│   ├── repositories/         # DB access
│   ├── services/             # Business logic
│   ├── db/                   # DB setup + migrations helpers
│   └── seed/                 # Seed scripts (live loop + recap)
├── sportz-frontend/          # Vite + React frontend
├── scripts/                  # Utility scripts (latency probe)
├── drizzle/                  # Drizzle migrations
├── drizzle.config.js
├── package.json
└── README.md
```

## Getting started

### Prerequisites

- Node.js 18+
- Postgres database (Neon or local)

### Installation

```bash
npm install
npm run fe:install
```

### Environment variables

Create a `.env` file in the repo root:

```env
# Database
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB

# Optional
# PORT=8000
```

Frontend (optional overrides) in `sportz-frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000/ws
```

### Run locally

Backend (API + WebSocket):

```bash
npm run db:migrate
npm run dev
```

Frontend:

```bash
npm run fe:dev
```

## Demo data

### Live loop

Posts new commentary (and score updates for live matches) every ~2–3 seconds.

```bash
npm run seed:live
```

### Finished match recaps

Backfills recap commentary for finished matches (useful if the UI shows “No recap available yet.”).

```bash
npm run seed:recap
```

## Measuring WebSocket latency

This repo includes a simple RTT probe that sends application-level `ping` messages and times the `pong` responses.

```bash
npm run ws:latency -- --count 50 --interval 20 --timeout 5000
```

The output prints min/avg/p50/p95/p99/max in milliseconds.

## Scripts

- `npm run dev`: start backend (watch mode)
- `npm run fe:dev`: start frontend dev server
- `npm run seed:live`: generate live commentary updates
- `npm run seed:recap`: backfill finished-match recap commentary
- `npm run ws:latency`: measure WebSocket RTT latency
- `npm test`: run Node tests
