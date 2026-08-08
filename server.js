require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const DISABLE_SUPABASE = process.env.DISABLE_SUPABASE === 'true';
const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 2 * 60 * 60 * 1000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT}`)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const SAFE_COLORS = {
  indigo: { id: 'indigo', bg: 'from-indigo-500 to-purple-600', text: 'text-indigo-200' },
  rose: { id: 'rose', bg: 'from-rose-500 to-pink-600', text: 'text-rose-200' },
  emerald: { id: 'emerald', bg: 'from-emerald-500 to-teal-600', text: 'text-emerald-200' },
  amber: { id: 'amber', bg: 'from-amber-500 to-orange-600', text: 'text-amber-200' },
  cyan: { id: 'cyan', bg: 'from-cyan-500 to-blue-600', text: 'text-cyan-200' }
};
const SAFE_STATUSES = new Set(['pending', 'approved', 'rejected']);
const adminSessions = new Map();
const rateLimitBuckets = new Map();

if (!ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD is not set in your environment variables. Admin login will fail.');
}

let supabase = null;
if (DISABLE_SUPABASE) {
  console.warn('Supabase disabled. Running in temporary memory mode.');
} else if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('Connected to Supabase Database');
} else {
  console.warn('Supabase credentials missing. Running in temporary memory mode.');
}

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function corsOrigin(origin, callback) {
  if (isOriginAllowed(origin)) return callback(null, true);
  return callback(new Error('Origin not allowed'));
}

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 10 * 1024
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '8kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.tailwindcss.com https://cdn.socket.io",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://api.qrserver.com",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.message === 'Origin not allowed') {
    return res.status(403).send('Forbidden');
  }
  return next(err);
});

let submissions = [];
let autoApprove = false;

function getClientIp(socket) {
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return socket.handshake.address || 'unknown';
}

function checkRateLimit(key, maxHits, windowMs) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxHits) return false;
  bucket.count += 1;
  return true;
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeId(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 80) return null;
  return normalized;
}

function normalizeColor(value) {
  const colorId = typeof value === 'string' ? value : value && value.id;
  return SAFE_COLORS[colorId] || SAFE_COLORS.indigo;
}

function normalizeStatus(value) {
  return SAFE_STATUSES.has(value) ? value : null;
}

function normalizeSubmission(record) {
  return {
    ...record,
    id: normalizeId(record.id),
    name: normalizeText(record.name, 30) || 'Anonymous',
    course: normalizeText(record.course, 20) || 'Student',
    message: normalizeText(record.message, 200) || '',
    color: normalizeColor(record.color),
    status: normalizeStatus(record.status) || 'pending',
    pinned: Boolean(record.pinned)
  };
}

function validateSubmission(data) {
  const name = normalizeText(data && data.name, 30);
  const course = normalizeText(data && data.course, 20);
  const message = normalizeText(data && data.message, 200);
  if (!name || !course || !message) {
    return { error: 'Please complete all fields using the allowed lengths.' };
  }
  return {
    value: {
      name,
      course,
      message,
      color: normalizeColor(data.color),
      status: autoApprove ? 'approved' : 'pending',
      pinned: false
    }
  };
}

function checkAdminPassword(password) {
  if (!ADMIN_PASSWORD || typeof password !== 'string') return false;
  const submitted = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  return submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
}

function createAdminSession(socket) {
  const token = crypto.randomBytes(32).toString('base64url');
  adminSessions.set(token, { expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
  socket.data.isAdmin = true;
  socket.data.adminToken = token;
  socket.join('admins');
  return token;
}

function validateAdminToken(token) {
  if (typeof token !== 'string') return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  return true;
}

function requireAdmin(socket, token) {
  if (!validateAdminToken(token)) {
    socket.data.isAdmin = false;
    socket.leave('admins');
    socket.emit('admin-auth-required');
    return false;
  }
  socket.data.isAdmin = true;
  socket.data.adminToken = token;
  socket.join('admins');
  return true;
}

async function loadSubmissions() {
  if (!supabase) {
    submissions = submissions.map(normalizeSubmission);
    return submissions;
  }

  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetch error:', error.message);
    return submissions;
  }

  submissions = (data || []).map(normalizeSubmission);
  return submissions;
}

function publicState() {
  return {
    submissions: submissions.filter(post => post.status === 'approved'),
    autoApprove: false
  };
}

function adminState() {
  return { submissions, autoApprove };
}

async function broadcastState() {
  await loadSubmissions();
  io.emit('state-changed', publicState());
  io.to('admins').emit('admin-state-changed', adminState());
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
  for (const [token, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) adminSessions.delete(token);
  }
}, 10 * 60 * 1000).unref();

io.on('connection', async (socket) => {
  await loadSubmissions();
  socket.emit('init-state', publicState());

  socket.on('verify-admin-pass', (password, callback) => {
    const ip = getClientIp(socket);
    if (!checkRateLimit(`admin-login:${ip}`, 5, 10 * 60 * 1000)) {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Too many admin login attempts. Please wait before trying again.' });
      }
      return;
    }

    const isValid = checkAdminPassword(password);
    if (typeof callback === 'function') {
      callback({
        success: isValid,
        token: isValid ? createAdminSession(socket) : undefined,
        state: isValid ? adminState() : undefined
      });
    }
  });

  socket.on('verify-admin-token', (token, callback) => {
    const success = requireAdmin(socket, token);
    if (typeof callback === 'function') {
      callback({ success, state: success ? adminState() : undefined });
    }
  });

  socket.on('submit-post', async (data, callback) => {
    const ip = getClientIp(socket);
    if (!checkRateLimit(`submit:${ip}`, 5, 60 * 1000)) {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Too many submissions. Please wait a moment before posting again.' });
      }
      return;
    }

    const { value: newPost, error: validationError } = validateSubmission(data);
    if (validationError) {
      if (typeof callback === 'function') callback({ success: false, error: validationError });
      return;
    }

    if (supabase) {
      const { error } = await supabase.from('submissions').insert([newPost]);
      if (error) {
        console.error('Supabase Insert Error:', error.message);
        if (typeof callback === 'function') callback({ success: false, error: 'Unable to save your submission right now.' });
        return;
      }
    } else {
      newPost.id = Date.now().toString();
      submissions.unshift(newPost);
    }

    if (typeof callback === 'function') callback({ success: true, status: newPost.status });
    await broadcastState();
  });

  socket.on('update-status', async ({ id, status, token } = {}) => {
    if (!requireAdmin(socket, token)) return;
    const safeId = normalizeId(id);
    const safeStatus = normalizeStatus(status);
    if (!safeId || !safeStatus) return;

    if (supabase) {
      await supabase.from('submissions').update({ status: safeStatus }).eq('id', safeId);
    } else {
      const post = submissions.find(s => s.id === safeId);
      if (post) post.status = safeStatus;
    }

    await broadcastState();
  });

  socket.on('toggle-pin', async ({ id, token } = {}) => {
    if (!requireAdmin(socket, token)) return;
    const safeId = normalizeId(id);
    if (!safeId) return;
    await loadSubmissions();

    if (supabase) {
      const post = submissions.find(s => s.id === safeId);
      const newPinnedState = post ? !post.pinned : true;
      await supabase.from('submissions').update({ pinned: newPinnedState }).eq('id', safeId);
    } else {
      const post = submissions.find(s => s.id === safeId);
      if (post) post.pinned = !post.pinned;
    }

    await broadcastState();
  });

  socket.on('delete-post', async ({ id, token } = {}) => {
    if (!requireAdmin(socket, token)) return;
    const safeId = normalizeId(id);
    if (!safeId) return;

    if (supabase) {
      await supabase.from('submissions').delete().eq('id', safeId);
    } else {
      submissions = submissions.filter(s => s.id !== safeId);
    }

    await broadcastState();
  });

  socket.on('toggle-auto-approve', async ({ autoApprove: value, token } = {}) => {
    if (!requireAdmin(socket, token)) return;
    autoApprove = value === true;
    await broadcastState();
  });

  socket.on('clear-all', async ({ token } = {}) => {
    if (!requireAdmin(socket, token)) return;

    if (supabase) {
      await supabase.from('submissions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      submissions = [];
    }

    await broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

module.exports = { app, server, io };
