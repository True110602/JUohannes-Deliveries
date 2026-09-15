// Shared UI helpers used across every page (button loading states,
// lightweight toast notifications). Previously this file didn't
// actually exist under this name — pages loaded "/js/ui-helpers.js"
// (hyphen) while the real file on disk was "ui helpers.js" (space),
// so the request 404'd silently and setButtonLoading() was undefined
// wherever it was called.

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;

  if (isLoading) {
    if (button.dataset.fxOriginalHtml === undefined) {
      button.dataset.fxOriginalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.innerHTML = `<span class="inline-spinner"></span>${loadingText || 'Please wait...'}`;
  } else {
    button.disabled = false;
    if (button.dataset.fxOriginalHtml !== undefined) {
      button.innerHTML = button.dataset.fxOriginalHtml;
      delete button.dataset.fxOriginalHtml;
    }
  }
}

// Wires up a drag-and-drop / click-to-browse image upload zone.
// dropZoneId: the container div (also the click target)
// fileInputId: the hidden <input type="file"> inside it
// previewImgId: an <img> element used to preview the uploaded picture
// hiddenUrlInputId: a hidden input that stores the resulting URL, so
//   existing form submission code that reads it doesn't need to change
// onUploaded(url): optional callback fired after a successful upload
// uploadUrl: which endpoint receives the file - defaults to the
//   merchant-only one (existing callers didn't specify this), but
//   account.html passes /api/account/upload-image so every role can
//   upload their own profile picture, not just merchants.
function setupImageDropZone({ dropZoneId, fileInputId, previewImgId, hiddenUrlInputId, onUploaded, uploadUrl }) {
  const zone = document.getElementById(dropZoneId);
  const input = document.getElementById(fileInputId);
  const preview = previewImgId ? document.getElementById(previewImgId) : null;
  const hiddenInput = hiddenUrlInputId ? document.getElementById(hiddenUrlInputId) : null;
  const endpoint = uploadUrl || '/api/merchant/upload-image';
  if (!zone || !input) return;

  function showPreview(url) {
    if (preview && url) {
      preview.src = url;
      preview.classList.add('fx-has-image');
    }
  }

  // If a URL is already set (e.g. loaded from a saved profile), show it.
  if (hiddenInput && hiddenInput.value) showPreview(hiddenInput.value);

  async function uploadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.', 'error');
      return;
    }

    const zoneTextEl = zone.querySelector('.fx-drop-zone-text');
    const originalText = zoneTextEl ? zoneTextEl.innerHTML : null;
    if (zoneTextEl) zoneTextEl.innerHTML = '<span class="inline-spinner fx-spinner-light"></span>Uploading...';

    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await authFetch(`${window.API_BASE}${endpoint}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        const fullUrl = data.url.startsWith('http') ? data.url : `${window.API_BASE}${data.url}`;
        if (hiddenInput) hiddenInput.value = fullUrl;
        showPreview(fullUrl);
        if (onUploaded) onUploaded(fullUrl);
      } else {
        showToast(data.message || 'Upload failed.', 'error');
      }
    } catch (err) {
      showToast('Server error uploading image.', 'error');
    } finally {
      if (zoneTextEl && originalText !== null) zoneTextEl.innerHTML = originalText;
    }
  }

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => uploadFile(input.files[0]));

  ['dragover', 'dragenter'].forEach(evt => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('fx-drop-active');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach(evt => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('fx-drop-active');
    });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    uploadFile(file);
  });
}

// --- Data Saver mode ---
// A visitor-controlled setting (stored locally, not per-account) that
// pages can check before doing anything data-heavy: loading the Leaflet
// map/tiles, fetching item/shop photos, or pulling in the Google Fonts
// stylesheet (see the inline loader script in each page's <head>).
// Kept dead simple (one flag, no server round-trip) since the entire
// point is to work well on a weak/expensive connection.
// Fetches the server's tile-provider config (see GET /api/map-config) and
// adds the matching Leaflet tile layer to the given map. Centralized here
// so all three map pages (customer/admin/driver) stay in sync and pick up
// a MAPTILER_API_KEY the moment it's set server-side, with no frontend
// changes needed. The map itself is created synchronously by the caller
// beforehand - this only adds the tile layer, so markers/click-handlers
// wired right after creating the map don't have to wait on this fetch.
async function addConfiguredTileLayer(map) {
  let cfg;
  try {
    const res = await fetch(`${window.API_BASE || ''}/api/map-config`);
    cfg = await res.json();
  } catch (err) {
    // Same CARTO fallback the server itself uses when no key is set -
    // keeps the map usable even if this one request fails.
    cfg = {
      tileUrlTemplate: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19
    };
  }
  L.tileLayer(cfg.tileUrlTemplate, {
    maxZoom: cfg.maxZoom || 19,
    subdomains: cfg.subdomains || undefined,
    attribution: cfg.attribution
  }).addTo(map);
}

function isDataSaverOn() {
  return localStorage.getItem('fx_data_saver') === 'on';
}

function setDataSaver(on) {
  localStorage.setItem('fx_data_saver', on ? 'on' : 'off');
}

// Renders a toggle switch into the given container id, wired to
// isDataSaverOn()/setDataSaver(). onChange(isOn) fires after the value is
// saved - most pages use it to just reload(), since disabling e.g. the
// map only takes effect on next render.
function renderDataSaverToggle(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const on = isDataSaverOn();
  container.innerHTML = `
    <label class="fx-data-saver-toggle">
      <span class="fx-switch">
        <input type="checkbox" id="fxDataSaverCheckbox" ${on ? 'checked' : ''}>
        <span class="fx-switch-track"></span>
      </span>
      Data Saver
    </label>
  `;
  document.getElementById('fxDataSaverCheckbox').addEventListener('change', (e) => {
    setDataSaver(e.target.checked);
    if (onChange) onChange(e.target.checked);
  });
}

// --- Support / "Report an issue" widget ---
// Injects a floating button + modal into the current page and wires it to
// POST /api/support. Works for a logged-in user (their account is
// attached automatically via authFetch's token) or a guest (falls back to
// a plain fetch and an optional name/email field). Call this once per
// page, after config.js has set window.API_BASE.
function initSupportWidget() {
  if (document.getElementById('fxSupportFab')) return; // already initialized

  const loggedIn = !!(typeof getAuthToken === 'function' && getAuthToken());

  const guestFieldsHtml = loggedIn ? '' : `
    <label>Your name</label>
    <input type="text" id="fxSupportName" placeholder="So we know who's reporting this">
    <label>Your email (optional)</label>
    <input type="email" id="fxSupportEmail" placeholder="So we can follow up">
  `;

  document.body.insertAdjacentHTML('beforeend', `
    <button type="button" id="fxSupportFab" class="fx-btn-ghost fx-support-fab">Report an issue</button>
    <div id="fxSupportModal" class="fx-modal-backdrop">
      <div class="fx-card fx-modal">
        <div class="fx-eyebrow">Support</div>
        <h3 style="margin-top:0;">Report a problem</h3>
        <form id="fxSupportForm">
          ${guestFieldsHtml}
          <label>What's this about?</label>
          <input type="text" id="fxSupportSubject" required placeholder="e.g. Order never arrived">
          <label>Details</label>
          <textarea id="fxSupportMessage" required rows="4" placeholder="Tell us what happened - order number, timing, anything that helps." style="width:100%; resize:vertical; font-family:inherit; padding:10px; border-radius:var(--radius-sm); background:rgba(255,255,255,0.03); border:1px solid var(--border); color:var(--text-0);"></textarea>
          <div class="fx-row-end" style="margin-top:12px;">
            <button type="button" id="fxSupportCancel" class="fx-btn-muted" style="width:auto;">Cancel</button>
            <button type="submit" id="fxSupportSubmit" style="width:auto;">Send report</button>
          </div>
        </form>
        <p id="fxSupportStatus" class="fx-support-status"></p>
      </div>
    </div>
  `);

  const modal = document.getElementById('fxSupportModal');
  const openModal = () => modal.classList.add('fx-open');
  const closeModal = () => {
    modal.classList.remove('fx-open');
    document.getElementById('fxSupportStatus').innerText = '';
  };

  document.getElementById('fxSupportFab').addEventListener('click', openModal);
  document.getElementById('fxSupportCancel').addEventListener('click', closeModal);

  document.getElementById('fxSupportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('fxSupportSubmit');
    const status = document.getElementById('fxSupportStatus');
    const payload = {
      subject: document.getElementById('fxSupportSubject').value,
      message: document.getElementById('fxSupportMessage').value
    };
    if (!loggedIn) {
      const nameEl = document.getElementById('fxSupportName');
      const emailEl = document.getElementById('fxSupportEmail');
      if (nameEl) payload.name = nameEl.value;
      if (emailEl) payload.email = emailEl.value;
    }

    setButtonLoading(submitBtn, true, 'Sending...');
    status.style.color = '';
    status.innerText = '';

    try {
      const base = window.API_BASE || '';
      const doFetch = loggedIn ? authFetch : fetch;
      const res = await doFetch(`${base}/api/support`, {
        method: 'POST',
        headers: loggedIn ? undefined : { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setButtonLoading(submitBtn, false);
      if (data.success) {
        status.style.color = '#4ade80';
        status.innerText = data.message || 'Thanks - your report has been logged.';
        document.getElementById('fxSupportForm').reset();
        setTimeout(closeModal, 1800);
      } else {
        status.style.color = '#ff5d7a';
        status.innerText = data.message || 'Could not send your report.';
      }
    } catch (err) {
      setButtonLoading(submitBtn, false);
      status.style.color = '#ff5d7a';
      status.innerText = 'Server connection error. Please try again.';
    }
  });
}

// Minimal HTML-escaping for untrusted, free-form user text (e.g. support
// ticket messages) before it's dropped into innerHTML via template
// literals elsewhere in the app.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// --- Notification center ---
// A bell icon + dropdown, shared across customer/driver/merchant/admin
// pages. Requires the page to already have loaded the Socket.IO client
// script (<script src="/socket.io/socket.io.js">) and to have a valid
// auth token - call this only after confirming the user is logged in.
let fxNotificationSocket = null;

function initNotificationCenter() {
  if (document.getElementById('fxNotifBell')) return; // already initialized
  const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
  if (!token) return; // notifications are for logged-in accounts only

  document.body.insertAdjacentHTML('beforeend', `
    <div id="fxNotifWrap" class="fx-notif-wrap">
      <button type="button" id="fxNotifBell" class="fx-btn-ghost fx-notif-bell" style="width:auto;">
        🔔<span id="fxNotifBadge" class="fx-notif-badge" style="display:none;">0</span>
      </button>
      <div id="fxNotifPanel" class="fx-card fx-notif-panel" style="display:none;">
        <div class="fx-row-end" style="justify-content:space-between; margin-bottom:8px;">
          <b>Notifications</b>
          <button type="button" id="fxNotifMarkAll" class="fx-btn-muted" style="width:auto; padding:4px 10px; font-size:12px;">Mark all read</button>
        </div>
        <div id="fxNotifList"><span class="inline-spinner fx-spinner-light"></span>Loading...</div>
      </div>
    </div>
  `);

  const panel = document.getElementById('fxNotifPanel');
  const badge = document.getElementById('fxNotifBadge');
  const list = document.getElementById('fxNotifList');

  function setUnreadCount(n) {
    if (n > 0) {
      badge.style.display = 'inline-block';
      badge.innerText = n > 9 ? '9+' : String(n);
    } else {
      badge.style.display = 'none';
    }
  }

  function renderList(notifications) {
    if (!notifications.length) {
      list.innerHTML = '<p class="fx-muted" style="margin:6px 0;">Nothing yet.</p>';
      return;
    }
    list.innerHTML = notifications.map(n => `
      <div class="fx-notif-item ${n.read ? '' : 'fx-notif-unread'}" data-id="${n._id}">
        <div style="font-weight:600; font-size:13px;">${escapeHtml(n.title)}</div>
        <div class="fx-muted" style="font-size:12.5px;">${escapeHtml(n.message)}</div>
        <div class="fx-muted" style="font-size:10.5px; margin-top:2px;">${new Date(n.createdAt).toLocaleString()}</div>
      </div>
    `).join('');

    list.querySelectorAll('.fx-notif-item').forEach(el => {
      el.addEventListener('click', async () => {
        if (!el.classList.contains('fx-notif-unread')) return;
        el.classList.remove('fx-notif-unread');
        try {
          await authFetch(`${window.API_BASE}/api/notifications/${el.dataset.id}/read`, { method: 'PATCH' });
          refreshUnreadCount();
        } catch (err) { /* visual state already updated; a background retry isn't worth the complexity here */ }
      });
    });
  }

  async function loadNotifications() {
    try {
      const res = await authFetch(`${window.API_BASE}/api/notifications`);
      const data = await res.json();
      if (data.success) {
        renderList(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch (err) {
      list.innerHTML = '<p class="fx-muted" style="margin:6px 0;">Could not load notifications.</p>';
    }
  }

  async function refreshUnreadCount() {
    try {
      const res = await authFetch(`${window.API_BASE}/api/notifications`);
      const data = await res.json();
      if (data.success) setUnreadCount(data.unreadCount);
    } catch (err) { /* stale badge count is a minor, self-correcting issue */ }
  }

  document.getElementById('fxNotifBell').addEventListener('click', () => {
    const willShow = panel.style.display === 'none';
    panel.style.display = willShow ? 'block' : 'none';
    if (willShow) loadNotifications();
  });

  document.getElementById('fxNotifMarkAll').addEventListener('click', async () => {
    try {
      await authFetch(`${window.API_BASE}/api/notifications/read-all`, { method: 'PATCH' });
      list.querySelectorAll('.fx-notif-unread').forEach(el => el.classList.remove('fx-notif-unread'));
      setUnreadCount(0);
    } catch (err) { showToast('Could not mark notifications as read.', 'error'); }
  });

  // Close the panel when clicking anywhere outside it.
  document.addEventListener('click', (e) => {
    if (!document.getElementById('fxNotifWrap').contains(e.target)) {
      panel.style.display = 'none';
    }
  });

  loadNotifications();

  // Live push: same socket.io client every map/tracking page already
  // loads. 'register' proves who we are (server verifies the token
  // itself - see server.js) so notifications actually land in the right
  // person's room instead of broadcasting to everyone.
  if (typeof io === 'function') {
    fxNotificationSocket = io(window.API_BASE || undefined);
    fxNotificationSocket.emit('register', token);
    fxNotificationSocket.on('notification', () => {
      // Re-fetch rather than trying to splice the pushed item into
      // whatever partial state the panel is in - simpler, and this list
      // is small enough that the extra request is negligible.
      refreshUnreadCount();
      if (panel.style.display !== 'none') loadNotifications();
    });
  }
}

async function renderNavAvatar(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const res = await authFetch(`${window.API_BASE}/api/account/me`);
    const data = await res.json();
    if (!data.success) return;
    if (data.user.profilePicUrl) {
      container.innerHTML = `<img src="${data.user.profilePicUrl}" class="fx-nav-avatar" alt="Your profile picture" title="My Account" onclick="window.location.href='/account.html'">`;
    } else {
      // No picture set yet - a fallback initial beats a broken image or
      // an empty gap in the nav, and doubles as a visible hint that
      // there's an avatar slot waiting to be filled in on account.html.
      const initial = ((data.user.name || data.user.email || '?').trim().charAt(0) || '?').toUpperCase();
      container.innerHTML = `<div class="fx-nav-avatar fx-nav-avatar-fallback" title="My Account" onclick="window.location.href='/account.html'">${initial}</div>`;
    }
  } catch (err) { /* nav avatar is decorative - fail silently */ }
}

function showToast(message, type) {
  let stack = document.querySelector('.fx-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'fx-toast-stack';
    document.body.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = `fx-toast ${type === 'error' ? 'err' : type === 'success' ? 'ok' : ''}`;
  toast.textContent = message;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}
