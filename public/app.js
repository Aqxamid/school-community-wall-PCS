const socket = io();

const SPOTLIGHT_INTERVAL = 45000;
const SPOTLIGHT_DURATION = 5000;

const BUBBLE_COLORS = [
  { id: 'indigo', bg: 'from-indigo-500 to-purple-600', text: 'text-indigo-200' },
  { id: 'rose', bg: 'from-rose-500 to-pink-600', text: 'text-rose-200' },
  { id: 'emerald', bg: 'from-emerald-500 to-teal-600', text: 'text-emerald-200' },
  { id: 'amber', bg: 'from-amber-500 to-orange-600', text: 'text-amber-200' },
  { id: 'cyan', bg: 'from-cyan-500 to-blue-600', text: 'text-cyan-200' }
];

let state = {
  submissions: [],
  autoApprove: false,
  activeView: 'tv',
  selectedColor: BUBBLE_COLORS[0],
  tvLayout: 'bubbles'
};
let physicsNodes = [];

socket.on('init-state', (data) => updateLocalState(data));
socket.on('state-changed', (data) => updateLocalState(data));
socket.on('admin-state-changed', (data) => updateLocalState(data));
socket.on('admin-auth-required', () => adminLogout());

window.addEventListener('DOMContentLoaded', () => {
  setupEventHandlers();
  setupColorPicker();
  setupDynamicQRCode();

  const urlParams = new URLSearchParams(window.location.search);
  const requestedView = urlParams.get('view') || 'tv';

  setTvLayout(state.tvLayout);
  switchView(requestedView);
  initPhysicsLoop();
  startSpotlightRotation();

  const adminToken = sessionStorage.getItem('adminToken');
  if (adminToken) verifyStoredAdminToken(adminToken);
});

function setupEventHandlers() {
  document.getElementById('layout-bubbles-btn')?.addEventListener('click', () => setTvLayout('bubbles'));
  document.getElementById('layout-grid-btn')?.addEventListener('click', () => setTvLayout('grid'));
  document.getElementById('submit-form')?.addEventListener('submit', handleFormSubmit);
  document.getElementById('view-wall-btn')?.addEventListener('click', viewCommunityWall);
  document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin);
  document.getElementById('admin-logout-btn')?.addEventListener('click', () => adminLogout());
  document.getElementById('auto-approve-toggle')?.addEventListener('change', (event) => {
    sendAdminAction('toggle-auto-approve', { autoApprove: event.target.checked });
  });
  document.getElementById('clear-all-btn')?.addEventListener('click', () => {
    if (confirm('Clear all data?')) sendAdminAction('clear-all', {});
  });
}

function updateLocalState(data) {
  if (!data) return;
  state.submissions = Array.isArray(data.submissions) ? data.submissions : [];
  state.autoApprove = data.autoApprove === true;

  const toggle = document.getElementById('auto-approve-toggle');
  if (toggle) toggle.checked = state.autoApprove;

  renderActiveView();
}

function setupDynamicQRCode() {
  const targetUrl = encodeURIComponent(`${window.location.origin}/?view=submit`);
  const qrImage = document.getElementById('qr-code-img');
  if (qrImage) {
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${targetUrl}`;
  }
}

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.view-panel').forEach(el => el.classList.add('hidden'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.remove('hidden');

  renderActiveView();
}

function renderActiveView() {
  if (state.activeView === 'tv') renderTvWall();
  if (state.activeView === 'admin') renderAdminPanel();
}

function handleAdminLogin(event) {
  event.preventDefault();
  const input = document.getElementById('admin-passcode-input').value;
  verifyPasscode(input);
}

function verifyPasscode(passcode) {
  socket.emit('verify-admin-pass', passcode, (res) => {
    if (res && res.success) {
      sessionStorage.setItem('adminToken', res.token);
      unlockAdmin();
      updateLocalState(res.state);
    } else {
      sessionStorage.removeItem('adminToken');
      showAuthError((res && res.error) || 'Incorrect passcode');
    }
  });
}

function verifyStoredAdminToken(token) {
  socket.emit('verify-admin-token', token, (res) => {
    if (res && res.success) {
      unlockAdmin();
      updateLocalState(res.state);
    } else {
      adminLogout();
    }
  });
}

function unlockAdmin() {
  document.getElementById('admin-auth-overlay')?.classList.add('hidden');
  document.getElementById('admin-content')?.classList.remove('hidden');
  document.getElementById('auth-error-msg')?.classList.add('hidden');
  renderAdminPanel();
}

function showAuthError(message) {
  const error = document.getElementById('auth-error-msg');
  if (!error) return;
  error.textContent = message;
  error.classList.remove('hidden');
}

function adminLogout() {
  sessionStorage.removeItem('adminToken');
  document.getElementById('admin-auth-overlay')?.classList.remove('hidden');
  document.getElementById('admin-content')?.classList.add('hidden');
  const input = document.getElementById('admin-passcode-input');
  if (input) input.value = '';
}

function sendAdminAction(eventName, data) {
  const token = sessionStorage.getItem('adminToken');
  if (!token) {
    alert('Session expired. Please log in again.');
    adminLogout();
    return;
  }
  socket.emit(eventName, { ...data, token });
}

function setupColorPicker() {
  const container = document.getElementById('color-selector');
  if (!container) return;
  container.replaceChildren(...BUBBLE_COLORS.map((color, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = colorButtonClass(index === 0, color);
    button.setAttribute('aria-label', `Select ${color.id} color`);
    button.addEventListener('click', () => selectColor(index));
    return button;
  }));
}

function selectColor(index) {
  state.selectedColor = BUBBLE_COLORS[index] || BUBBLE_COLORS[0];
  document.querySelectorAll('.color-btn').forEach((button, i) => {
    button.className = colorButtonClass(i === index, BUBBLE_COLORS[i]);
  });
}

function colorButtonClass(selected, color) {
  return `h-10 rounded-xl bg-gradient-to-tr ${color.bg} border-2 ${selected ? 'border-white scale-105' : 'border-transparent'} color-btn`;
}

function handleFormSubmit(event) {
  event.preventDefault();
  setSubmitError('');

  const submitButton = document.getElementById('submit-post-btn');
  if (submitButton) submitButton.disabled = true;

  socket.emit('submit-post', {
    name: document.getElementById('input-name').value.trim(),
    course: document.getElementById('input-course').value.trim(),
    message: document.getElementById('input-message').value.trim(),
    color: state.selectedColor.id
  }, (res) => {
    if (submitButton) submitButton.disabled = false;
    if (!res || !res.success) {
      setSubmitError((res && res.error) || 'Unable to submit right now. Please try again.');
      return;
    }
    document.getElementById('form-container').classList.add('hidden');
    document.getElementById('success-container').classList.remove('hidden');
  });
}

function setSubmitError(message) {
  const error = document.getElementById('submit-error-msg');
  if (!error) return;
  error.textContent = message;
  error.classList.toggle('hidden', !message);
}

function viewCommunityWall() {
  window.location.href = '/';
}

function setTvLayout(layout) {
  state.tvLayout = layout;
  const bubblesButton = document.getElementById('layout-bubbles-btn');
  const gridButton = document.getElementById('layout-grid-btn');
  if (bubblesButton) {
    bubblesButton.className = `px-3 py-1.5 rounded-xl text-xs font-bold ${layout === 'bubbles' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`;
  }
  if (gridButton) {
    gridButton.className = `px-3 py-1.5 rounded-xl text-xs font-bold ${layout === 'grid' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`;
  }
  renderTvWall();
}

function renderTvWall() {
  const approved = state.submissions.filter(post => post.status === 'approved');
  const canvas = document.getElementById('tv-canvas');
  if (!canvas) return;
  canvas.replaceChildren();

  if (state.tvLayout === 'grid') {
    canvas.className = 'relative w-full h-full overflow-y-auto p-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';
    canvas.replaceChildren(...approved.map(createGridPost));
    physicsNodes = [];
    return;
  }

  canvas.className = 'relative w-full h-full overflow-hidden';
  physicsNodes = approved.map(post => {
    const node = createBubblePost(post);
    canvas.appendChild(node.element);
    return node;
  });
}

function createGridPost(post) {
  const card = createElement('div', `cursor-pointer bg-slate-900 border ${post.pinned ? 'border-rose-500 pinned-glow' : 'border-slate-800'} p-6 rounded-3xl`);
  card.addEventListener('click', () => triggerSpotlight(post.id));
  card.appendChild(createElement('div', 'font-bold text-sm text-white mb-2', `${safeText(post.name)} (${safeText(post.course)})`));
  card.appendChild(createElement('p', 'text-sm text-slate-200', `"${safeText(post.message)}"`));
  return card;
}

function createBubblePost(post) {
  const color = colorFor(post);
  const size = post.pinned ? 240 : 190;
  const element = createElement('div', `bubble absolute rounded-full p-6 flex flex-col justify-center items-center text-center cursor-pointer bg-gradient-to-tr ${color.bg} ${post.pinned ? 'pinned-glow border-2 border-rose-400' : 'border border-white/20'} shadow-2xl`);
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.appendChild(createElement('span', 'text-[10px] font-black uppercase text-white/80 mb-1', safeText(post.course)));
  element.appendChild(createElement('p', 'text-xs font-bold text-white line-clamp-3 leading-snug', `"${safeText(post.message)}"`));
  element.appendChild(createElement('span', 'text-[11px] font-extrabold text-white mt-2', `- ${safeText(post.name)}`));
  element.addEventListener('click', () => triggerSpotlight(post.id));

  return {
    element,
    x: Math.random() * Math.max(window.innerWidth - size, 0),
    y: Math.random() * Math.max(window.innerHeight - size, 0),
    vx: (Math.random() - 0.5) * 0.8,
    vy: (Math.random() - 0.5) * 0.8,
    radius: size / 2
  };
}

function initPhysicsLoop() {
  function updatePhysics() {
    if (state.activeView === 'tv' && state.tvLayout === 'bubbles') {
      physicsNodes.forEach(node => {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x <= 0 || node.x + node.radius * 2 >= window.innerWidth) node.vx *= -1;
        if (node.y <= 0 || node.y + node.radius * 2 >= window.innerHeight) node.vy *= -1;
        node.element.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
      });
    }
    requestAnimationFrame(updatePhysics);
  }
  updatePhysics();
}

function startSpotlightRotation() {
  setInterval(() => {
    if (state.activeView === 'tv') {
      const approved = state.submissions.filter(post => post.status === 'approved');
      if (approved.length > 0) {
        triggerSpotlight(approved[Math.floor(Math.random() * approved.length)].id);
      }
    }
  }, SPOTLIGHT_INTERVAL);
}

function triggerSpotlight(postId) {
  const post = state.submissions.find(item => item.id === postId);
  if (!post) return;

  document.getElementById('spotlight-text').textContent = `"${safeText(post.message)}"`;
  document.getElementById('spotlight-name').textContent = safeText(post.name);
  document.getElementById('spotlight-course').textContent = safeText(post.course);

  const color = colorFor(post);
  const avatar = document.getElementById('spotlight-avatar');
  avatar.textContent = safeText(post.name).charAt(0) || 'A';
  avatar.className = `w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white text-lg bg-gradient-to-tr ${color.bg}`;

  const modal = document.getElementById('spotlight-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none');
  setTimeout(() => modal.classList.add('opacity-0', 'pointer-events-none'), SPOTLIGHT_DURATION);
}

function renderAdminPanel() {
  if (!sessionStorage.getItem('adminToken')) return;
  const container = document.getElementById('admin-posts-grid');
  if (!container) return;
  container.replaceChildren(...state.submissions.map(createAdminPost));
}

function createAdminPost(post) {
  const card = createElement('div', `bg-slate-900 border ${post.pinned ? 'border-rose-500' : 'border-slate-800'} p-5 rounded-2xl space-y-4`);
  const header = createElement('div', 'flex items-center justify-between');
  const statusClass = post.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400';
  header.appendChild(createElement('span', `text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusClass}`, safeText(post.status)));
  if (post.pinned) header.appendChild(createElement('span', 'text-xs text-rose-400 font-bold', 'Pinned'));

  const footer = createElement('div', 'pt-3 border-t border-slate-800 flex items-center justify-between text-xs');
  footer.appendChild(createElement('div', '', `${safeText(post.name)} (${safeText(post.course)})`));

  const actions = createElement('div', 'flex gap-1');
  if (post.status !== 'approved') {
    actions.appendChild(createAdminButton('Approve', 'bg-emerald-500/10 text-emerald-400', () => {
      sendAdminAction('update-status', { id: post.id, status: 'approved' });
    }));
  }
  if (post.status !== 'rejected') {
    actions.appendChild(createAdminButton('Reject', 'bg-amber-500/10 text-amber-400', () => {
      sendAdminAction('update-status', { id: post.id, status: 'rejected' });
    }));
  }
  actions.appendChild(createAdminButton('Pin', 'bg-slate-800 text-slate-300', () => {
    sendAdminAction('toggle-pin', { id: post.id });
  }));
  actions.appendChild(createAdminButton('Delete', 'bg-rose-500/10 text-rose-400', () => {
    sendAdminAction('delete-post', { id: post.id });
  }));
  footer.appendChild(actions);

  card.appendChild(header);
  card.appendChild(createElement('p', 'text-sm font-semibold text-white', `"${safeText(post.message)}"`));
  card.appendChild(footer);
  return card;
}

function createAdminButton(label, className, onClick) {
  const button = createElement('button', `px-2 py-1 rounded ${className}`, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function colorFor(post) {
  const colorId = typeof post.color === 'string' ? post.color : post.color && post.color.id;
  return BUBBLE_COLORS.find(color => color.id === colorId) || BUBBLE_COLORS[0];
}

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
