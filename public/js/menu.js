// HAMBURGER MENU - JAVASCRIPT

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
    this.sidebar.classList.toggle('hidden');
    this.hamburger.classList.toggle('active');
    this.overlay?.classList.toggle('active');
  }

  closeSidebar() {
    this.sidebar.classList.add('hidden');
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
  new HamburgerMenu();
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
