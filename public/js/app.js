/**
 * BigBasket Telegram Mini App - Frontend Controller
 * 
 * Handles:
 * - Telegram WebApp integration
 * - Navigation between pages
 * - API calls to our backend proxy
 * - Cart management
 * - Product rendering
 */

// ==================== INIT ====================
const tg = window.Telegram?.WebApp;
let sessionId = null;
let telegramId = null;
let currentPage = 'home';
let cart = [];
let cartCount = 0;

// Sample data for offline/demo mode
const DEMO_CATEGORIES = [
  { id: '1', name: 'Fruits & Vegetables', icon: '🥬' },
  { id: '2', name: 'Foodgrains & Oil', icon: '🌾' },
  { id: '3', name: 'Bakery & Dairy', icon: '🥛' },
  { id: '4', name: 'Beverages', icon: '🥤' },
  { id: '5', name: 'Snacks', icon: '🍿' },
  { id: '6', name: 'Eggs, Meat & Fish', icon: '🥚' },
  { id: '7', name: 'Cleaning', icon: '🧹' },
  { id: '8', name: 'Beauty & Hygiene', icon: '💄' },
  { id: '9', name: 'Baby Care', icon: '🍼' },
  { id: '10', name: 'Kitchen', icon: '🍳' },
  { id: '11', name: 'Gourmet', icon: '🧀' },
  { id: '12', name: 'Pet Care', icon: '🐕' },
];

const DEMO_PRODUCTS = [
  { id: 'p1', name: 'Organic Bananas', unit: '1 Dozen', price: 49, mrp: 60, image: '🍌', category: '1' },
  { id: 'p2', name: 'Fresh Tomatoes', unit: '500 g', price: 29, mrp: 35, image: '🍅', category: '1' },
  { id: 'p3', name: 'Amul Butter', unit: '100 g', price: 56, mrp: 58, image: '🧈', category: '3' },
  { id: 'p4', name: 'Tata Tea Gold', unit: '500 g', price: 275, mrp: 310, image: '🍵', category: '4' },
  { id: 'p5', name: 'Aashirvaad Atta', unit: '5 kg', price: 295, mrp: 340, image: '🌾', category: '2' },
  { id: 'p6', name: 'Lay\'s Classic', unit: '90 g', price: 20, mrp: 20, image: '🥔', category: '5' },
  { id: 'p7', name: 'Amul Toned Milk', unit: '500 ml', price: 28, mrp: 30, image: '🥛', category: '3' },
  { id: 'p8', name: 'Onions', unit: '1 kg', price: 35, mrp: 45, image: '🧅', category: '1' },
  { id: 'p9', name: 'Farm Eggs', unit: '6 pcs', price: 54, mrp: 60, image: '🥚', category: '6' },
  { id: 'p10', name: 'Coca-Cola', unit: '750 ml', price: 38, mrp: 40, image: '🥤', category: '4' },
  { id: 'p11', name: 'Maggi Noodles', unit: '280 g (4 pack)', price: 52, mrp: 56, image: '🍜', category: '5' },
  { id: 'p12', name: 'Rice (Sona Masoori)', unit: '5 kg', price: 399, mrp: 450, image: '🍚', category: '2' },
];

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  try {
    // Init Telegram WebApp
    if (tg) {
      tg.ready();
      tg.expand();
      telegramId = tg.initDataUnsafe?.user?.id;
      
      // Apply Telegram theme
      document.body.style.backgroundColor = tg.themeParams?.bg_color || '#ffffff';
      document.body.style.color = tg.themeParams?.text_color || '#1a1a1a';
    }

    // Try to create session with backend
    if (telegramId) {
      try {
        const response = await apiCall('/session/create', 'POST', {
          telegram_id: telegramId,
          init_data: tg?.initData,
        });
        if (response.success) {
          sessionId = response.session_id;
        }
      } catch (e) {
        console.log('Session create failed, running in demo mode');
      }
    }

    // Setup navigation
    setupNavigation();
    setupSearch();

    // Load initial data (always falls back to demo)
    await loadHomePage();
  } catch (e) {
    console.error('Init error:', e);
    // Force load demo data even if something fails
    renderHomeCategories(DEMO_CATEGORIES.slice(0, 8));
    renderProducts(DEMO_PRODUCTS.slice(0, 6), 'home-products');
  } finally {
    // ALWAYS hide loading screen
    document.getElementById('loading-screen').classList.add('hidden');
  }
}

// ==================== API ====================

const API_BASE = window.location.origin + '/api';

async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (sessionId) headers['X-Session-Id'] = sessionId;
  if (telegramId) headers['X-Telegram-Id'] = String(telegramId);

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  // Add timeout to prevent hanging
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  options.signal = controller.signal;

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ==================== NAVIGATION ====================

function setupNavigation() {
  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
    });
  });

  // All data-page links
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Cart header button
  document.getElementById('cart-header-btn').addEventListener('click', () => {
    navigateTo('cart');
  });
}

function navigateTo(page) {
  currentPage = page;

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  
  // Show target page
  const targetPage = document.getElementById(`page-${page}`);
  if (targetPage) targetPage.classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // Load page data
  switch (page) {
    case 'home': loadHomePage(); break;
    case 'categories': loadCategories(); break;
    case 'cart': loadCart(); break;
    case 'orders': loadOrders(); break;
    case 'profile': loadProfile(); break;
  }
}

// ==================== SEARCH ====================

function setupSearch() {
  const searchBar = document.getElementById('search-bar');
  const searchToggle = document.getElementById('search-toggle-btn');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const searchClose = document.getElementById('search-close-btn');

  searchToggle.addEventListener('click', () => {
    searchBar.style.display = searchBar.style.display === 'none' ? 'flex' : 'none';
    if (searchBar.style.display === 'flex') searchInput.focus();
  });

  searchClose.addEventListener('click', () => {
    searchBar.style.display = 'none';
    searchInput.value = '';
  });

  searchBtn.addEventListener('click', () => performSearch());
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
}

async function performSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  document.getElementById('search-title').textContent = `Results: "${query}"`;
  navigateTo('search');

  // Try API search first
  try {
    const data = await apiCall(`/products/search?q=${encodeURIComponent(query)}`);
    if (data.products) {
      renderProducts(data.products, 'search-results');
      return;
    }
  } catch (e) {}

  // Fallback to demo search
  const results = DEMO_PRODUCTS.filter(p => 
    p.name.toLowerCase().includes(query.toLowerCase())
  );
  renderProducts(results, 'search-results');
}

// ==================== HOME PAGE ====================

async function loadHomePage() {
  // Always render demo data first (instant UI)
  renderHomeCategories(DEMO_CATEGORIES.slice(0, 8));
  renderProducts(DEMO_PRODUCTS.slice(0, 6), 'home-products');

  // Then try API to overlay with real data
  try {
    const data = await apiCall('/home');
    if (data && data.categories) {
      renderHomeCategories(data.categories.slice(0, 8));
    }
    if (data && data.products) {
      renderProducts(data.products.slice(0, 6), 'home-products');
    }
  } catch (e) {
    console.log('API unavailable, using demo data');
  }
}

function renderHomeCategories(categories) {
  const container = document.getElementById('home-categories');
  container.innerHTML = categories.map(cat => `
    <div class="category-card" onclick="openCategory('${cat.id}', '${cat.name}')">
      <span class="category-icon">${cat.icon || '📦'}</span>
      <span class="category-name">${cat.name}</span>
    </div>
  `).join('');
}

// ==================== CATEGORIES ====================

async function loadCategories() {
  // Render demo immediately
  const container = document.getElementById('categories-list');
  container.innerHTML = DEMO_CATEGORIES.map(cat => `
    <div class="category-item" onclick="openCategory('${cat.id}', '${cat.name}')">
      <span class="category-icon">${cat.icon || '📦'}</span>
      <span class="category-name">${cat.name}</span>
    </div>
  `).join('');

  // Try API overlay
  try {
    const data = await apiCall('/categories');
    const categories = data.categories || (Array.isArray(data) ? data : null);
    if (categories && categories.length > 0) {
      container.innerHTML = categories.map(cat => `
        <div class="category-item" onclick="openCategory('${cat.id}', '${cat.name}')">
          <span class="category-icon">${cat.icon || '📦'}</span>
          <span class="category-name">${cat.name}</span>
        </div>
      `).join('');
    }
  } catch (e) {
    console.log('Categories API unavailable');
  }
}

function openCategory(categoryId, categoryName) {
  document.getElementById('products-title').textContent = categoryName || 'Products';
  navigateTo('products');
  loadCategoryProducts(categoryId);
}

async function loadCategoryProducts(categoryId) {
  let products = DEMO_PRODUCTS.filter(p => p.category === categoryId);

  try {
    const data = await apiCall(`/categories/${categoryId}/products`);
    if (data.products || Array.isArray(data)) {
      products = data.products || data;
    }
  } catch (e) {}

  if (products.length === 0) {
    products = DEMO_PRODUCTS.slice(0, 4); // Fallback
  }

  renderProducts(products, 'products-list');
}

// ==================== PRODUCTS ====================

function renderProducts(products, containerId) {
  const container = document.getElementById(containerId);
  if (!products || products.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--hint-color); grid-column:span 2; padding:40px;">No products found</p>';
    return;
  }

  container.innerHTML = products.map(product => {
    const inCart = cart.find(c => c.id === product.id);
    const discount = product.mrp > product.price ? Math.round((1 - product.price / product.mrp) * 100) : 0;

    return `
      <div class="product-card">
        <div class="product-image">${product.image || '📦'}</div>
        <div class="product-info">
          <div class="product-name">${product.name}</div>
          <div class="product-unit">${product.unit || ''}</div>
          <div class="product-price">
            <span class="price-current">₹${product.price}</span>
            ${product.mrp > product.price ? `<span class="price-mrp">₹${product.mrp}</span>` : ''}
            ${discount > 0 ? `<span class="price-discount">${discount}% OFF</span>` : ''}
          </div>
          ${inCart ? `
            <div class="qty-controls">
              <button class="qty-btn" onclick="updateCartQty('${product.id}', ${inCart.quantity - 1})">-</button>
              <span class="qty-value">${inCart.quantity}</span>
              <button class="qty-btn" onclick="updateCartQty('${product.id}', ${inCart.quantity + 1})">+</button>
            </div>
          ` : `
            <button class="add-to-cart-btn" onclick="addToCart('${product.id}', '${escapeStr(product.name)}', '${product.image || '📦'}', ${product.price}, ${product.mrp || product.price}, '${product.unit || ''}')">
              ADD
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// ==================== CART ====================

function addToCart(id, name, image, price, mrp, unit) {
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.quantity++;
  } else {
    cart.push({ id, name, image, price, mrp, unit, quantity: 1 });
  }
  updateCartBadge();
  showToast(`Added to cart!`);

  // Re-render current products to show qty controls
  if (currentPage === 'home') loadHomePage();
  else if (currentPage === 'products') {
    const title = document.getElementById('products-title').textContent;
    const catId = DEMO_CATEGORIES.find(c => c.name === title)?.id;
    if (catId) loadCategoryProducts(catId);
  }

  // Sync with backend
  try {
    apiCall('/cart/add', 'POST', {
      product_id: id,
      product_name: name,
      product_image: image,
      price,
      mrp,
      unit,
      quantity: existing ? existing.quantity : 1,
    });
  } catch (e) {}
}

function updateCartQty(productId, newQty) {
  if (newQty <= 0) {
    cart = cart.filter(c => c.id !== productId);
    try { apiCall('/cart/remove', 'POST', { product_id: productId }); } catch(e) {}
  } else {
    const item = cart.find(c => c.id === productId);
    if (item) item.quantity = newQty;
    try { apiCall('/cart/update', 'POST', { product_id: productId, quantity: newQty }); } catch(e) {}
  }
  updateCartBadge();

  // Re-render based on current view
  if (currentPage === 'cart') loadCart();
  else if (currentPage === 'home') loadHomePage();
  else if (currentPage === 'products') {
    const title = document.getElementById('products-title').textContent;
    const catId = DEMO_CATEGORIES.find(c => c.name === title)?.id;
    if (catId) loadCategoryProducts(catId);
  }
}

function loadCart() {
  const container = document.getElementById('cart-items');
  const emptyState = document.getElementById('cart-empty');
  const summary = document.getElementById('cart-summary');

  if (cart.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    summary.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  summary.style.display = 'block';

  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-image">${item.image}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-unit">${item.unit}</div>
        <div class="cart-item-bottom">
          <span class="cart-item-price">₹${item.price * item.quantity}</span>
          <div class="qty-controls">
            <button class="qty-btn" onclick="updateCartQty('${item.id}', ${item.quantity - 1})">-</button>
            <span class="qty-value">${item.quantity}</span>
            <button class="qty-btn" onclick="updateCartQty('${item.id}', ${item.quantity + 1})">+</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  // Update summary
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const delivery = subtotal > 500 ? 0 : 30;
  document.getElementById('cart-subtotal').textContent = `₹${subtotal}`;
  document.getElementById('cart-delivery').textContent = delivery === 0 ? 'FREE' : `₹${delivery}`;
  document.getElementById('cart-total').textContent = `₹${subtotal + delivery}`;
}

function updateCartBadge() {
  cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const badge = document.getElementById('cart-badge');
  badge.textContent = cartCount;
  badge.style.display = cartCount > 0 ? 'flex' : 'none';
}

// ==================== ORDERS ====================

async function loadOrders() {
  try {
    const data = await apiCall('/orders');
    if (data.orders && data.orders.length > 0) {
      renderOrders(data.orders);
      return;
    }
  } catch (e) {}

  // Demo orders
  document.getElementById('orders-list').innerHTML = '';
  document.getElementById('orders-empty').style.display = 'block';
}

function renderOrders(orders) {
  document.getElementById('orders-empty').style.display = 'none';
  const container = document.getElementById('orders-list');
  container.innerHTML = orders.map(order => `
    <div class="order-card">
      <div class="order-header">
        <span class="order-id">#${order.order_id || order.id}</span>
        <span class="order-status ${order.status?.toLowerCase()}">${order.status || 'Processing'}</span>
      </div>
      <div class="order-items-preview">${order.items_count || 0} items</div>
      <div class="order-total">₹${order.total || 0}</div>
    </div>
  `).join('');
}

// ==================== PROFILE ====================

function loadProfile() {
  if (tg?.initDataUnsafe?.user) {
    document.getElementById('profile-name').textContent = 
      tg.initDataUnsafe.user.first_name + ' ' + (tg.initDataUnsafe.user.last_name || '');
  }
}

// ==================== UTILITIES ====================

function escapeStr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// Checkout button
document.getElementById('checkout-btn')?.addEventListener('click', () => {
  if (cart.length === 0) return;
  
  if (tg) {
    // Use Telegram's payment/confirmation
    tg.showConfirm('Place this order?', (confirmed) => {
      if (confirmed) placeOrder();
    });
  } else {
    if (confirm('Place this order?')) placeOrder();
  }
});

async function placeOrder() {
  try {
    const result = await apiCall('/orders/place', 'POST', {
      items: cart,
      total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
    });
    
    if (result.success || result.order_id) {
      cart = [];
      updateCartBadge();
      showToast('Order placed successfully! 🎉');
      navigateTo('orders');
    } else {
      showToast('Failed to place order');
    }
  } catch (e) {
    showToast('Order placed (demo mode) 🎉');
    cart = [];
    updateCartBadge();
    navigateTo('orders');
  }
}

// Logout
document.getElementById('logout-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  if (tg) {
    tg.showConfirm('Logout from BigBasket?', (confirmed) => {
      if (confirmed) {
        sessionId = null;
        showToast('Logged out');
        if (tg) tg.close();
      }
    });
  }
});
