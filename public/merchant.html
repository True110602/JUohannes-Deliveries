<!DOCTYPE html>
<html lang="en">
<head>
  <script src="/js/config.js"></script>
  <script src="/js/ui-helpers.js"></script>
  <script>
    authFetch(`${window.API_BASE}/api/check-session`)
      .then(res => res.json())
      .then(data => {
        if (!data.loggedIn) {
          window.location.href = '/login.html';
        }
      });
  </script>
  <meta charset="UTF-8">
  <title>Johannes Deliveries - Merchant Portal</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f4f4f9; display: flex; min-height: 100vh; }
    
    /* Sidebar Layout */
    .sidebar { width: 280px; background: #1e293b; color: white; padding: 20px; display: flex; flex-direction: column; gap: 20px; flex-shrink: 0; }
    .sidebar-profile { text-align: center; border-bottom: 1px solid #334155; padding-bottom: 15px; }
    .profile-img { width: 90px; height: 90px; border-radius: 50%; object-fit: cover; border: 3px solid #007bff; margin-bottom: 10px; background: #334155; }
    .sidebar h3 { font-size: 16px; margin: 0 0 10px 0; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    
    /* Stats Widget */
    .stat-card { background: #334155; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
    .stat-card .label { font-size: 12px; color: #cbd5e1; }
    .stat-card .value { font-size: 20px; font-weight: bold; color: #22c55e; margin-top: 4px; }
    
    /* Main Content Area */
    .main-content { flex: 1; padding: 30px; overflow-y: auto; }
    .container { max-width: 700px; background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin: auto; }
    
    input, textarea, select, button { width: 100%; padding: 10px; margin-top: 6px; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 4px; }
    button { background: #007bff; color: white; border: none; font-weight: bold; cursor: pointer; }
    button:disabled { background: #6c757d; cursor: not-allowed; }
    
    .sidebar input, .sidebar button { font-size: 12px; padding: 8px; margin-bottom: 8px; }
    .sidebar button { background: #0d9488; margin-top: 4px; }

    /* Catalog Cards */
    .item-list { margin-top: 20px; }
    .item-card { border: 1px solid #ddd; padding: 15px; border-radius: 6px; margin-bottom: 12px; background: #fafafa; display: flex; gap: 15px; align-items: flex-start; }
    .item-card img { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; }
    .item-info { flex: 1; }
    .btn-toggle { width: auto; padding: 6px 12px; margin: 4px 0 0 0; font-size: 12px; }
    .badge { display: inline-block; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 4px; margin-top: 4px; }
    .hint { font-size: 12px; color: #666; margin-top: -8px; margin-bottom: 10px; }
  </style>
</head>
<body>

  <!-- Left Sidebar Navigation -->
  <div class="sidebar">
    <div class="sidebar-profile">
      <img id="profilePicDisplay" class="profile-img" src="https://via.placeholder.com/90?text=Merchant" alt="Profile Picture" onerror="this.src='https://via.placeholder.com/90?text=Merchant'">
      <h4 id="merchantEmailText" style="margin: 0; font-size: 14px; color: #f8fafc;">Merchant Account</h4>
      
      <div style="margin-top: 10px;">
        <input type="url" id="profilePicUrlInput" placeholder="Profile Image URL">
        <button type="button" onclick="updateProfilePic()">Update Photo</button>
      </div>
    </div>

    <!-- Sales & Earnings Stats -->
    <div>
      <h3>Performance</h3>
      <div class="stat-card">
        <div class="label">Total Sales Made</div>
        <div class="value" id="statSalesCount">0 orders</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Revenue Earned</div>
        <div class="value" id="statRevenueAmount">$0.00</div>
      </div>
    </div>

    <!-- Bank Details Form -->
    <div>
      <h3>Payment / Bank Details</h3>
      <form id="bankDetailsForm">
        <input type="text" id="bankName" placeholder="Bank Name (e.g. CABS, FBC)" required>
        <input type="text" id="accountName" placeholder="Account Holder Name" required>
        <input type="text" id="accountNumber" placeholder="Account Number / EcoCash" required>
        <button type="submit" id="saveBankBtn">Save Payment Details</button>
      </form>
      <div id="bankMsg" style="font-size: 11px; text-align: center;"></div>
    </div>
  </div>

  <!-- Main Catalog Manager Content -->
  <div class="main-content">
    <div class="container">
      <h2>Merchant Catalog Manager</h2>
      
      <form id="addItemForm">
        <label>Item Name:</label>
        <input type="text" id="itemName" required placeholder="e.g. Mozambican Piri-Piri Chicken">
        
        <label>Price (USD):</label>
        <input type="number" id="itemPrice" step="0.01" required placeholder="12.50">

        <label>Description:</label>
        <textarea id="itemDescription" rows="2" style="width: 100%; padding: 8px; margin-top: 6px; margin-bottom: 12px;" placeholder="Brief description of the product..."></textarea>

        <label>Image URL:</label>
        <input type="url" id="itemImageUrl" placeholder="https://example.com/item-photo.jpg">

        <label>Sizes (comma-separated):</label>
        <input type="text" id="itemSizes" placeholder="Small, Medium, Large">

        <label>Flavors (comma-separated):</label>
        <input type="text" id="itemFlavors" placeholder="Mild, Hot Piri-Piri, Extra Spicy">

        <label>Colors (comma-separated):</label>
        <input type="text" id="itemColors" placeholder="Red, Black, Blue">
        <div class="hint">Leave options blank if they don't apply to this item.</div>

        <button type="submit" id="submitBtn">Add Item to Catalog</button>
      </form>

      <h3>Current Catalog</h3>
      <div id="catalogContainer" class="item-list">
        Loading items...
      </div>
    </div>
  </div>

  <script>
    // Fetch merchant sales stats and bank details on initial load
    async function loadMerchantDashboard() {
      try {
        const res = await authFetch(`${window.API_BASE}/api/orders`);
        if (res.ok) {
          const orders = await res.json();
          const completedOrders = orders.filter(o => o.status === 'delivered');
          
          document.getElementById('statSalesCount').innerText = `${completedOrders.length} orders`;
          
          const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
          document.getElementById('statRevenueAmount').innerText = `$${totalRevenue.toFixed(2)}`;
        }
      } catch (err) {
        console.error('Error loading dashboard stats:', err);
      }

      // Load saved profile picture & bank details from LocalStorage fallback
      const savedPic = localStorage.getItem('merchant_profile_pic');
      if (savedPic) {
        document.getElementById('profilePicDisplay').src = savedPic;
        document.getElementById('profilePicUrlInput').value = savedPic;
      }

      const savedBank = JSON.parse(localStorage.getItem('merchant_bank_details') || '{}');
      if (savedBank.bankName) document.getElementById('bankName').value = savedBank.bankName;
      if (savedBank.accountName) document.getElementById('accountName').value = savedBank.accountName;
      if (savedBank.accountNumber) document.getElementById('accountNumber').value = savedBank.accountNumber;
    }

    // Profile Picture Update Handler
    function updateProfilePic() {
      const url = document.getElementById('profilePicUrlInput').value.trim();
      if (url) {
        document.getElementById('profilePicDisplay').src = url;
        localStorage.setItem('merchant_profile_pic', url);
        alert('Profile picture updated successfully!');
      }
    }

    // Bank Details Save Handler
    document.getElementById('bankDetailsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const bankDetails = {
        bankName: document.getElementById('bankName').value,
        accountName: document.getElementById('accountName').value,
        accountNumber: document.getElementById('accountNumber').value
      };

      localStorage.setItem('merchant_bank_details', JSON.stringify(bankDetails));
      const msg = document.getElementById('bankMsg');
      msg.style.color = '#22c55e';
      msg.innerText = 'Bank details saved successfully!';
      setTimeout(() => { msg.innerText = ''; }, 3000);
    });

    // Fetch and display menu items
    async function fetchCatalog() {
      const container = document.getElementById('catalogContainer');
      try {
        const res = await authFetch(`${window.API_BASE}/api/catalog`);
        const items = await res.json();
        container.innerHTML = '';

        if (items.length === 0) {
          container.innerHTML = '<i>No catalog items found. Add your first item above!</i>';
          return;
        }

        items.forEach(item => {
          const div = document.createElement('div');
          div.className = 'item-card';

          const optionsHtml = (item.optionGroups || []).map(group => `
            <div>
              <small><strong>${group.groupName}:</strong> ${group.choices.map(c => `<span class="badge">${c}</span>`).join('')}</small>
            </div>
          `).join('');

          div.innerHTML = `
            ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" onerror="this.style.display='none'">` : ''}
            <div class="item-info">
              <strong>${item.name}</strong> - $${item.price.toFixed(2)}
              <span style="color: ${item.inStock ? 'green' : 'red'}; font-weight: bold;">(${item.inStock ? 'In Stock' : 'Out of Stock'})</span>
              ${item.description ? `<p style="font-size:13px; color:#555; margin: 4px 0;">${item.description}</p>` : ''}
              ${optionsHtml}
              <button class="btn-toggle" onclick="toggleStock('${item._id}', this)">
                ${item.inStock ? 'Mark Out of Stock' : 'Mark In Stock'}
              </button>
            </div>
          `;
          container.appendChild(div);
        });
      } catch (err) {
        container.innerHTML = 'Error loading catalog.';
      }
    }

    // Form submit for adding new catalog item
    document.getElementById('addItemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      submitBtn.innerText = 'Adding Item...';

      const optionGroups = [];

      const sizes = document.getElementById('itemSizes').value.split(',').map(s => s.trim()).filter(Boolean);
      if (sizes.length > 0) optionGroups.push({ groupName: 'Size', choices: sizes });

      const flavors = document.getElementById('itemFlavors').value.split(',').map(f => f.trim()).filter(Boolean);
      if (flavors.length > 0) optionGroups.push({ groupName: 'Flavor', choices: flavors });

      const colors = document.getElementById('itemColors').value.split(',').map(c => c.trim()).filter(Boolean);
      if (colors.length > 0) optionGroups.push({ groupName: 'Color', choices: colors });

      const payload = {
        name: document.getElementById('itemName').value,
        price: parseFloat(document.getElementById('itemPrice').value),
        description: document.getElementById('itemDescription').value,
        imageUrl: document.getElementById('itemImageUrl').value,
        optionGroups
      };

      try {
        const res = await authFetch(`${window.API_BASE}/api/catalog`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          document.getElementById('addItemForm').reset();
          fetchCatalog();
        } else {
          alert('Failed to add item');
        }
      } catch (err) {
        alert('Server connection error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Add Item to Catalog';
      }
    });

    // Toggle item stock state
    async function toggleStock(id, button) {
      button.disabled = true;
      try {
        const res = await authFetch(`${window.API_BASE}/api/catalog/${id}/stock`, {
          method: 'PATCH'
        });
        if (res.ok) {
          fetchCatalog();
        } else {
          alert('Failed to update stock status');
        }
      } catch (err) {
        alert('Server error updating stock');
      }
    }

    // Initialize Page
    loadMerchantDashboard();
    fetchCatalog();
  </script>

</body>
</html>
