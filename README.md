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
```

`SUPABASE_URL` and `SUPABASE_KEY` are optional. If they are not set, the app will use local memory storage instead.

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
