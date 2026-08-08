# School Community Wall

A simple real-time school community wall app built with Node.js, Express, Socket.io, and Supabase.

## Features

- Live submission form for students to share ideas and contributions
- Real-time wall display for TV screens
- Admin panel for approving, rejecting, pinning, and deleting posts
- Optional Supabase storage with local in-memory fallback

## Getting Started

### Install dependencies

```bash
npm install
```

### Environment variables

Create a `.env` file in the project root with:

```env
ADMIN_PASSWORD=yourAdminPasscode
SUPABASE_URL=https://your-supabase-url
SUPABASE_KEY=your-supabase-key
ALLOWED_ORIGINS=http://localhost:3000,https://your-school-wall.example
ADMIN_SESSION_TTL_MS=7200000
```

`SUPABASE_URL` and `SUPABASE_KEY` are optional. If they are not set, the app will use local memory storage instead.

`ALLOWED_ORIGINS` controls which browser origins may connect to Express and Socket.io. Set this to your production domain before deploying. If omitted, the app allows local development on `localhost` and `127.0.0.1` for the configured port.

`ADMIN_SESSION_TTL_MS` controls how long an admin session token stays alive. The default is 2 hours.

### Run the app

```bash
npm start
```

Then open the app in your browser at:

```text
http://localhost:3000
```

## Project Structure

- `server.js` — Node/Express server with Socket.io and Supabase support
- `public/` — Frontend HTML/CSS/JS
- `.gitignore` — Ignored files for Git

## Notes

- Make sure `ADMIN_PASSWORD` is set before using the admin panel.
- The app uses real-time Socket.io updates for both submissions and admin state changes.
- The server validates submission length and allowed colors/statuses, rate-limits public submissions and admin login attempts, and only sends pending/rejected posts to authenticated admin sessions.
- Keep `package-lock.json` committed so dependency installs are repeatable.
