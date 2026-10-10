// Shared helpers for the section pages (orders, products, users, reports ...).
// Load AFTER menu.js. Usage:
//   const me = JD.guard('merchant');           // redirects to login if not allowed
//   const items = await JD.api('/api/merchant/catalog');

const JD = {
  token() {
    try { return localStorage.getItem('token'); } catch (e) { return null; }
  },

  session() {
    return typeof jdGetSession === 'function' ? jdGetSession() : null;
  },

  // Redirect to login unless the visitor is signed in with one of the roles.
  // Returns the session ({role, email}) or null (while redirecting).
  guard(...roles) {
    const s = this.session();
    if (!s) { window.location.replace('/login.html'); return null; }
    if (roles.length && !roles.includes(s.role)) {
      const home = { admin: 'admin.html', merchant: 'merchant.html', driver: 'driver.html', customer: 'customer.html' };
      window.location.replace('/' + (home[s.role] || 'customer.html'));
      return null;
    }
    return s;
  },

  // fetch wrapper: adds the token, parses JSON, throws Error(message) on failure.
  async api(path, opts = {}) {
    const headers = { Authorization: 'Bearer ' + (this.token() || '') };
    let body;
    if (opts.form) {
      body = opts.form; // FormData - browser sets the content type
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await fetch((window.API_BASE || '') + path, { method: opts.method || 'GET', headers, body });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON response */ }
    if (res.status === 401 || (res.status === 403 && data && /token/i.test(data.message || ''))) {
      try { localStorage.removeItem('token'); } catch (e) {}
      window.location.replace('/login.html');
      throw new Error('Session expired - please sign in again.');
    }
    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && data.message) || 'Request failed (' + res.status + ')');
    }
    return data;
  },

  esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  money(n) { return '$' + (Number(n) || 0).toFixed(2); },

  date(d, withTime) {
    if (!d) return '-';
    const x = new Date(d);
    return withTime ? x.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : x.toLocaleDateString([], { dateStyle: 'medium' });
  },

  badge(status) {
    const label = String(status || '').replace(/_/g, ' ');
    return `<span class="badge ${this.esc(status)}">${this.esc(label)}</span>`;
  },

  toast(msg) { if (typeof jdToast === 'function') jdToast(msg); },

  empty(icon, text) {
    return `<div class="empty"><div class="big">${icon}</div>${this.esc(text)}</div>`;
  },

  // Render an error into a container (or toast when no container).
  fail(err, container) {
    const msg = (err && err.message) || String(err);
    if (container) container.innerHTML = `<div class="error-box">${this.esc(msg)}</div>`;
    else this.toast(msg);
  },

  // Builds a table. cols: [{h:'Header', f:row=>html}]
  table(cols, rows) {
    if (!rows.length) return '';
    return `<div class="table-wrap"><table class="data"><thead><tr>${cols.map(c => `<th>${c.h}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => `<tr>${cols.map(c => `<td>${c.f(r)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
  },

  // Tab strip. tabs: [{id,label,count}], onChange(id) fired on click. Returns setActive(id).
  tabs(el, tabs, active, onChange) {
    const draw = () => {
      el.innerHTML = tabs.map(t =>
        `<button class="tab ${t.id === active ? 'active' : ''}" data-id="${t.id}">${this.esc(t.label)}${t.count != null ? `<span class="count">${t.count}</span>` : ''}</button>`
      ).join('');
    };
    el.classList.add('tabs');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      active = b.dataset.id;
      draw();
      onChange(active);
    });
    draw();
    return {
      set(id) { active = id; draw(); },
      counts(map) { tabs.forEach(t => { if (map[t.id] != null) t.count = map[t.id]; }); draw(); }
    };
  },

  param(name) { return new URLSearchParams(location.search).get(name); },

  // Last N days as [{label, key}] for simple daily charts.
  lastDays(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      out.push({ key: d.toDateString(), label: d.toLocaleDateString([], { weekday: 'short' }) });
    }
    return out;
  },

  bars(items) { // items: [{label, value, text}]
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="bars">${items.map(i =>
      `<div class="bar"><b>${this.esc(i.text != null ? i.text : i.value)}</b><i style="height:${Math.round((i.value / max) * 100)}%"></i><span>${this.esc(i.label)}</span></div>`
    ).join('')}</div>`;
  },

  statCard(k, v, n) {
    return `<div class="stat-card"><div class="k">${this.esc(k)}</div><div class="v">${v}</div>${n ? `<div class="n">${this.esc(n)}</div>` : ''}</div>`;
  }
};
