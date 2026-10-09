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

  const dash = { admin: 'admin.html', merchant: 'merchant.html', driver: 'driver.html', customer: 'customer.html' };
  let html = `<li class="menu-section-title">Main</li>` +
    link('/' + (dash[session.role] || 'customer.html'), '📊', 'Dashboard');
  if (session.role === 'merchant' || session.role === 'admin') {
    html += link('/spreadsheet-import.html', '📥', 'Bulk Import');
  }
  html += `<li class="menu-section-title">Account</li>` + link('/account.html', '⚙️', 'Settings');
  return html;
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
        if (window.innerWidth <= 768) {
          this.closeSidebar();
        }
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
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    this.menuLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPage || href === '/' + currentPage) {
        link.classList.add('active');
        
        // Activate parent submenu if exists
        const parent = link.closest('.menu-item');
        const parentSubmenu = parent?.querySelector('.submenu');
        if (parentSubmenu) {
          parentSubmenu.classList.add('active');
        }
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
