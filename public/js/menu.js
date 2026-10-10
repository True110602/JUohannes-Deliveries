// HAMBURGER MENU - JAVASCRIPT
// Loaded on every page. Pages that already ship their own navbar/sidebar markup
// keep it; pages without one (login, register, forgot-password, ...) get a
// navbar + sidebar injected automatically.

function jdGetSession() {
  let token = null;
  try { token = localStorage.getItem('token'); } catch (e) {}
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    let email = payload.email || '';
    try { email = localStorage.getItem('userEmail') || email; } catch (e) {}
    return { role: payload.role || 'customer', email };
  } catch (e) {
    return null;
  }
}

function jdBuildMenuItems(session) {
  const link = (href, icon, label) =>
    `<li class="menu-item"><a href="${href}" class="menu-link"><span class="menu-icon">${icon}</span>${label}</a></li>`;

  if (!session) {
    return `<li class="menu-section-title">Welcome</li>` +
      link('/', '🏠', 'Home') +
      link('/login.html', '🔑', 'Login') +
      link('/register.html', '📝', 'Register') +
      link('/forgot-password.html', '❓', 'Forgot password');
  }

  const menus = {
    customer: [
      ['Main', [['customer.html', '🏠', 'Home'], ['orders.html', '📦', 'Orders'], ['restaurants.html', '🍽️', 'Restaurants'], ['restaurants.html?favorites=1', '❤️', 'Favorites'], ['customer.html#mapSection', '🗺️', 'Track Delivery']]],
      ['Account', [['wallet.html', '💳', 'Wallet'], ['account.html', '⚙️', 'Settings']]]
    ],
    merchant: [
      ['Main', [['merchant.html', '📊', 'Dashboard'], ['products.html', '🍽️', 'Products'], ['spreadsheet-import.html', '📤', 'Bulk Import'], ['merchant-orders.html', '📦', 'Orders'], ['reports.html', '📈', 'Reports'], ['shop-location.html', '📍', 'Shop Map']]],
      ['Account', [['account.html', '⚙️', 'Settings']]]
    ],
    driver: [
      ['Main', [['driver.html', '🗺️', 'Live Map'], ['driver-orders.html', '📦', 'Active Orders'], ['driver-orders.html?tab=available', '📋', 'Available Orders'], ['driver-orders.html?tab=history', '📈', 'History'], ['driver-earnings.html', '💰', 'Earnings']]],
      ['Account', [['account.html', '⚙️', 'Settings']]]
    ],
    admin: [
      ['Main', [['admin.html', '📊', 'Dashboard'], ['admin.html#map', '🗺️', 'Live Map']]],
      ['Management', [['admin-users.html', '👥', 'Users'], ['admin-merchants.html', '🏪', 'Merchants'], ['admin-drivers.html', '🚗', 'Drivers'], ['admin-orders.html', '📦', 'Orders']]],
      ['Analytics', [['admin-reports.html', '📈', 'Reports'], ['admin-logs.html', '📋', 'Logs']]],
      ['Account', [['account.html', '⚙️', 'Settings']]]
    ]
  };
  return (menus[session.role] || menus.customer).map(([title, links]) =>
    `<li class="menu-section-title">${title}</li>` + links.map(([h, i, l]) => link('/' + h, i, l)).join('')
  ).join('');
}

function jdInjectMenu() {
  if (document.querySelector('.hamburger')) return; // page already has its own menu

  const session = jdGetSession();
  const initials = (session ? session.email.split('@')[0] : 'JD').substring(0, 2).toUpperCase();

  document.body.classList.add('has-auto-menu');
  document.body.insertAdjacentHTML('afterbegin', `
<nav class="navbar">
  <div class="navbar-left">
    <button class="hamburger" aria-label="Toggle menu"><span></span><span></span><span></span></button>
    <a href="/" class="navbar-logo">📦 JUohannes</a>
  </div>
  <div class="navbar-right">
    <a class="profile-icon" href="${session ? '/account.html' : '/login.html'}" style="text-decoration:none">👤</a>
  </div>
</nav>
<aside class="sidebar hidden">
  <div class="sidebar-header">
    <div class="sidebar-user">
      <div class="sidebar-user-avatar">${session ? initials : '📦'}</div>
      <div class="sidebar-user-info">
        <h3>${session ? session.email.split('@')[0] : 'Guest'}</h3>
        <p>${session ? session.email : 'Not signed in'}</p>
      </div>
    </div>
  </div>
  <ul class="sidebar-menu">${jdBuildMenuItems(session)}</ul>
  ${session ? `<div class="sidebar-footer"><a href="/login.html" class="sidebar-footer-link logout"><span>🚪</span> Logout</a></div>` : ''}
</aside>
<div class="sidebar-overlay"></div>`);
}

class HamburgerMenu {
  constructor() {
    this.hamburger = document.querySelector('.hamburger');
    this.sidebar = document.querySelector('.sidebar');
    this.overlay = document.querySelector('.sidebar-overlay');
    this.mainContent = document.querySelector('.main-content');
    this.menuLinks = document.querySelectorAll('.menu-link');
    this.submenus = document.querySelectorAll('.menu-link[data-submenu]');

    this.init();
  }

  init() {
    if (this.hamburger) {
      this.hamburger.addEventListener('click', () => this.toggleSidebar());
    }

    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.closeSidebar());
    }

    // Menu links
    this.menuLinks.forEach(link => {
      link.addEventListener('click', (e) => this.handleMenuClick(e));
    });

    // Submenus
    this.submenus.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleSubmenu(link);
      });
    });

    // Close sidebar on mobile when clicking a link
    this.menuLinks.forEach(link => {
      link.addEventListener('click', () => {
        // The sidebar slides over the page at every width, so always close it.
        this.closeSidebar();
      });
    });

    this.setActiveMenu();
  }

  toggleSidebar() {
    if (!this.sidebar) return;
    this.sidebar.classList.toggle('hidden');
    this.hamburger?.classList.toggle('active');
    this.overlay?.classList.toggle('active');
  }

  closeSidebar() {
    this.sidebar?.classList.add('hidden');
    this.hamburger?.classList.remove('active');
    this.overlay?.classList.remove('active');
  }

  toggleSubmenu(link) {
    const submenuId = link.getAttribute('data-submenu');
    const submenu = document.getElementById(submenuId);
    
    if (submenu) {
      submenu.classList.toggle('active');
      link.classList.toggle('active');
    }
  }

  handleMenuClick(e) {
    const href = e.currentTarget.getAttribute('href');
    if (href && !href.startsWith('#')) {
      // External navigation
      window.location.href = href;
    }
  }

  setActiveMenu() {
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const full = page + window.location.search;
    const norm = (h) => (h || '').replace(/^\//, '');
    const links = [...this.menuLinks];

    // Prefer an exact match including the query string (Favorites vs Restaurants),
    // then fall back to a match on the page alone.
    let matched = links.filter(l => norm(l.getAttribute('href')) === full);
    if (!matched.length) matched = links.filter(l => { const h = norm(l.getAttribute('href')); return h === page || (h.split('?')[0] === page && !h.includes('?')); });

    links.forEach(link => {
      if (matched.includes(link)) {
        link.classList.add('active');
        const parentSubmenu = link.closest('.menu-item')?.querySelector('.submenu');
        if (parentSubmenu) parentSubmenu.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  updateStats(stats) {
    const statElements = document.querySelectorAll('[data-stat]');
    statElements.forEach(el => {
      const statKey = el.getAttribute('data-stat');
      if (stats[statKey] !== undefined) {
        el.textContent = stats[statKey];
      }
    });
  }

  updateUserInfo(name, email, initials) {
    const userNameEl = document.querySelector('.sidebar-user-info h3');
    const userEmailEl = document.querySelector('.sidebar-user-info p');
    const avatarEl = document.querySelector('.sidebar-user-avatar');

    if (userNameEl) userNameEl.textContent = name;
    if (userEmailEl) userEmailEl.textContent = email;
    if (avatarEl) avatarEl.textContent = initials;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  jdInjectMenu();
  new HamburgerMenu();

  // Logging out must clear the session, otherwise the login page
  // sees the valid token and sends the user straight back in.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.sidebar-footer-link.logout')) {
      try { localStorage.removeItem('token'); } catch (err) {}
    }
  });

  // Placeholder links (href="#"): go somewhere real when we can, otherwise tell
  // the user instead of silently doing nothing.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href="#"]');
    if (!a || a.hasAttribute('data-submenu')) return;
    e.preventDefault();
    const label = a.textContent.replace(/\s+/g, ' ').trim();

    if (/bulk import/i.test(label)) { window.location.href = '/spreadsheet-import.html'; return; }

    const orders = document.getElementById('ordersContainer');
    if (orders && /order|history/i.test(label)) {
      document.querySelector('.sidebar-overlay.active')?.click();
      orders.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    jdToast(label.replace(/^[^\w]+/, '') + ' is coming soon');
  });

  // Escape closes the menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelector('.sidebar-overlay.active')?.click();
  });
});

// Fetch and update stats from API
async function updateDashboardStats(endpoint) {
  try {
    const response = await fetch(endpoint);
    const data = await response.json();
    
    if (data.success) {
      // Update sidebar stats
      const menu = new HamburgerMenu();
      menu.updateStats(data);
    }
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

function jdToast(msg) {
  let t = document.getElementById('jd-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'jd-toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#333;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;z-index:3000;transition:opacity .3s;box-shadow:0 4px 12px rgba(0,0,0,.25)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.opacity = '0'; }, 2200);
}
