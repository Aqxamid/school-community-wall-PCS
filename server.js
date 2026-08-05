require('dotenv').config(); // Loads environment variables from local .env file

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Environment Variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.warn("⚠️ WARNING: ADMIN_PASSWORD is not set in your environment variables! Admin login will fail.");
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Supabase Database Connection
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("⚡ Connected to Supabase Database");
} else {
  console.warn("⚠️ Supabase credentials missing. Running in temporary memory mode.");
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Data Store (Fallback)
let submissions = [];
let autoApprove = false;

// Helper to check admin credentials
const checkAdmin = (password) => password === ADMIN_PASSWORD;

// Helper: Fetch fresh data from Supabase or return local memory
async function loadSubmissions() {
  if (!supabase) return submissions;
  
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetch error:', error.message);
    return submissions;
  }
  
  submissions = data || [];
  return submissions;
}

// Helper: Broadcast current state to all connected TV screens & clients
async function broadcastState() {
  await loadSubmissions();
  io.emit('state-changed', { submissions, autoApprove });
}

// Socket.io Real-Time Event Handlers
io.on('connection', async (socket) => {
  // Send current state to newly connected client
  await loadSubmissions();
  socket.emit('init-state', { submissions, autoApprove });

  // Verify Admin Passcode from lock screen
  socket.on('verify-admin-pass', (password, callback) => {
    const isValid = checkAdmin(password);
    if (typeof callback === 'function') {
      callback({ success: isValid });
    }
  });

  // Handle new submission from mobile form (Public access)
  socket.on('submit-post', async (data) => {
    const newPost = {
      name: data.name,
      course: data.course,
      message: data.message,
      color: data.color,
      status: autoApprove ? 'approved' : 'pending',
      pinned: false
    };

    if (supabase) {
      const { error } = await supabase.from('submissions').insert([newPost]);
      if (error) console.error('Supabase Insert Error:', error.message);
    } else {
      newPost.id = Date.now().toString();
      submissions.unshift(newPost);
    }

    await broadcastState();
  });

  // --- PROTECTED ADMIN ACTIONS ---

  socket.on('update-status', async ({ id, status, password }) => {
    if (!checkAdmin(password)) return;

    if (supabase) {
      await supabase.from('submissions').update({ status }).eq('id', id);
    } else {
      const post = submissions.find(s => s.id === id);
      if (post) post.status = status;
    }

    await broadcastState();
  });

  socket.on('toggle-pin', async ({ id, password }) => {
    if (!checkAdmin(password)) return;

    if (supabase) {
      const post = submissions.find(s => s.id === id);
      const newPinnedState = post ? !post.pinned : true;
      await supabase.from('submissions').update({ pinned: newPinnedState }).eq('id', id);
    } else {
      const post = submissions.find(s => s.id === id);
      if (post) post.pinned = !post.pinned;
    }

    await broadcastState();
  });

  socket.on('delete-post', async ({ id, password }) => {
    if (!checkAdmin(password)) return;

    if (supabase) {
      await supabase.from('submissions').delete().eq('id', id);
    } else {
      submissions = submissions.filter(s => s.id !== id);
    }

    await broadcastState();
  });

  socket.on('toggle-auto-approve', ({ autoApprove: value, password }) => {
    if (!checkAdmin(password)) return;
    autoApprove = value;
    io.emit('state-changed', { submissions, autoApprove });
  });

  socket.on('clear-all', async ({ password } = {}) => {
    if (!checkAdmin(password)) return;

    if (supabase) {
      // Delete all records in table
      await supabase.from('submissions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      submissions = [];
    }

    await broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});