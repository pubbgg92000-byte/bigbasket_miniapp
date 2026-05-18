/**
 * BigBasket Telegram Mini App - Frontend
 * Handles Telegram WebApp integration, navigation, API calls, cart management
 */

// ==================== INIT ====================
const tg = window.Telegram?.WebApp;
let sessionId = null;
let telegramId = null;
let currentPage = 'home';
let cart = [];
let cartCount = 0;
let allCategories = [];
let isAuthenticated = false;

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // Init Telegram WebApp
  if (tg) {
    tg.ready();
    tg.expand();
    telegramId = tg.initDataUnsafe?.user?.id;
    
    // Apply Telegram theme colors
    const root = document.documentElement;
    if (tg.themeParams) {
      root.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#ffffff');
      root.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#1a1a1a');
      root.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || '#999999');
      root.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color || '#2481cc');
      root.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || '#84c225');
      root.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff');
      root.style.setProperty('--tg-theme-secondary-bg-color', tg.themeParams.secondary_bg_color || '#f5f5f5');
    }
  }

  // Create session with backend
  if (telegramId) {
    try {
      const response = await apiCall('/session/create', 'POST', {
        telegram_id: telegramId,
        init_data: tg?.initData,
      });
      if (response.success) {
        sessionId = response.session_id;
        isAuthenticated = true;
      }
    } catch (e) {
      console.log('[APP] Running in demo mode - not authenticated');
    }
  }

  // Setup UI
  setupNavigation();
  setupSearch();

  // Load initial data
  await loadHomePage();

  // Hide loading screen
  setTimeout(() => {
    document.getElementById('loading-screen').classList.add('hidden');
  }, 500);
}

// ==================== API ====================

const API_BASE = window.location.origin + '/api';

async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers['X-Session-Id'] = sessionId;
  if (telegramId) headers['X-Telegram-Id'] = String(telegramId);

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();
    
    if (response.status === 401) {
      showToast('Please login via the Telegram bot first');
      return { error: 'unauthorized' };
    }
    
    return data;
  } catch (e) {
    console.error('[APP] API call failed:', endpoint, e.message);
    return { error: e.message };
  }
}

// ==================== NAVIGATION ====================

function setupNavigation() {
  // Bottom nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // All data-page links
  document.querySelectorAll('[data-page]').forEach(el => {
    if (!el.classList.contains('nav-item')) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    }
  });

  // Cart header button
  document.getElementById('cart-header-btn')?.addEventListener('click', () => navigateTo('cart'));
}

function navigateTo(page) {
  currentPage = page;

  // Hide all pages, show target
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById(`page-${page}`);
  if (targetPage) targetPage.classList.add('active');

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // Load page data
  switch (page) {
    case 'home': loadHomePage(); break;
    case 'categories': loadCategories(); break;
    case 'cart': renderCart(); break;
    case 'orders': loadOrders(); break;
    case 'profile': loadProfile(); break;
  }

  // Scroll to top
  window.scrollTo(0, 0);
}

// ==================== SEARCH ====================

function setupSearch() {
  const searchBar = document.getElementById('search-bar');
  const searchToggle = document.getElementById('search-toggle-btn');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const searchClose = document.getElementById('search-close-btn');

  searchToggle?.addEventListener('click', () => {
    const isHidden = searchBar.style.display === 'none';
    searchBar.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) searchInput.focus();
  });

  searchClose?.addEventListener('click', () => {
    searchBar.style.display = 'none';
    searchInput.value = '';
  });

  searchBtn?.addEventListener('click', () => performSearch());
  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
}

async function performSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  document.getElementById('search-title').textContent = `"${query}"`;
  navigateTo('search');

  const container = document.getElementById('search-results');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Searching...</p></div>';

  try {
    const data = await apiCall(`/products/search?q=${encodeURIComponent(query)}`);
    if (data.products && data.products.length > 0) {
      renderProducts(data.products, 'search-results');
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔍</span>
          <p>No products found for "${query}"</p>
          <p class="hint">Try a different search term</p>
        </div>`;
    }
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Search failed. Try again.</p></div>';
  }
}

// ==================== HOME PAGE ====================

async function loadHomePage() {
  try {
    const data = await apiCall('/home');
    
    if (data.categories && data.categories.length > 0) {
      allCategories = data.categories;
      renderHomeCategories(data.categories.slice(0, 8));
    } else {
      renderHomeCategories(DEFAULT_CATEGORIES.slice(0, 8));
    }

    if (data.products && data.products.length > 0) {
      renderProducts(data.products.slice(0, 6), 'home-products');
    } else {
      renderProducts(DEFAULT_PRODUCTS.slice(0, 6), 'home-products');
    }

    if (data.banners && data.banners.length > 0) {
      renderBanners(data.banners);
    }
  } catch (e) {
    // Fallback to demo data
    renderHomeCategories(DEFAULT_CATEGORIES.slice(0, 8));
    renderProducts(DEFAULT_PRODUCTS.slice(0, 6), 'home-products');
  }
}

function renderHomeCategories(categories) {
  const container = document.getElementById('home-categories');
  if (!container) return;
  
  container.innerHTML = categories.map(cat => `
    <div class="category-card" onclick="openCategory('${cat.id}', '${escapeHtml(cat.name)}')">
      <span class="category-icon">${cat.icon && cat.icon.startsWith('http') ? `<img src="${cat.icon}" alt="${cat.name}" width="32" height="32">` : (cat.icon || '📦')}</span>
      <span class="category-name">${cat.name}</span>
    </div>
  `).join('');
}

function renderBanners(banners) {
  const container = document.getElementById('banner-carousel');
  if (!container || !banners.length) return;

  container.innerHTML = banners.map((banner, i) => `
    <div class="banner-slide ${i === 0 ? 'active' : ''}">
      ${banner.image ? `<img src="${banner.image}" alt="${banner.title || ''}" style="width:100%;height:100%;object-fit:cover;">` : `
      <div class="banner-placeholder">
        <span>🛒</span>
        <p>${banner.title || 'Fresh Groceries Delivered!'}</p>
      </div>`}
    </div>
  `).join('');

  // Auto-rotate banners
  if (banners.length > 1) {
    let currentBanner = 0;
    setInterval(() => {
      const slides = container.querySelectorAll('.banner-slide');
      slides[currentBanner].classList.remove('active');
      currentBanner = (currentBanner + 1) % slides.length;
      slides[currentBanner].classList.add('active');
    }, 4000);
  }
}

// ==================== CATEGORIES ====================

async function loadCategories() {
  const container = document.getElementById('categories-list');
  if (!container) return;

  if (allCategories.length > 0) {
    renderCategoriesList(allCategories);
    return;
  }

  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading categories...</p></div>';

  try {
    const data = await apiCall('/categories');
    const categories = data.categories || data || [];
    if (categories.length > 0) {
      allCategories = categories;
      renderCategoriesList(categories);
    } else {
      renderCategoriesList(DEFAULT_CATEGORIES);
    }
  } catch (e) {
    renderCategoriesList(DEFAULT_CATEGORIES);
  }
}

function renderCategoriesList(categories) {
  const container = document.getElementById('categories-list');
  container.innerHTML = categories.map(cat => `
    <div class="category-item" onclick="openCategory('${cat.id}', '${escapeHtml(cat.name)}')">
      <span class="category-icon">${cat.icon && cat.icon.startsWith('http') ? `<img src="${cat.icon}" alt="" width="28" height="28">` : (cat.icon || '📦')}</span>
      <span class="category-name">${cat.name}</span>
      <span class="category-arrow">›</span>
    </div>
  `).join('');
}

function openCategory(categoryId, categoryName) {
  document.getElementById('products-title').textContent = categoryName || 'Products';
  navigateTo('products');
  loadCategoryProducts(categoryId);
}

async function loadCategoryProducts(categoryId) {
  const container = document.getElementById('products-list');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading products...</p></div>';

  try {
    const data = await apiCall(`/categories/${categoryId}/products`);
    if (data.products && data.products.length > 0) {
      renderProducts(data.products, 'products-list');
    } else {
      // Fallback
      const filtered = DEFAULT_PRODUCTS.filter(p => p.category === categoryId);
      renderProducts(filtered.length > 0 ? filtered : DEFAULT_PRODUCTS.slice(0, 4), 'products-list');
    }
  } catch (e) {
    renderProducts(DEFAULT_PRODUCTS.slice(0, 4), 'products-list');
  }
}

// ==================== PRODUCTS ====================

function renderProducts(products, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!products || products.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📦</span><p>No products found</p></div>';
    return;
  }

  container.innerHTML = products.map(product => {
    const inCart = cart.find(c => c.id === product.id);
    const price = parseFloat(product.price) || 0;
    const mrp = parseFloat(product.mrp) || price;
    const discount = mrp > price ? Math.round((1 - price / mrp) * 100) : 0;
    const hasImage = product.image && product.image.startsWith('http');

    return `
      <div class="product-card">
        <div class="product-image">
          ${hasImage ? `<img src="${product.image}" alt="${escapeHtml(product.name)}" loading="lazy">` : '📦'}
        </div>
        <div class="product-info">
          <div class="product-name">${escapeHtml(product.name)}</div>
          <div class="product-unit">${product.unit || ''}</div>
          <div class="product-price">
            <span class="price-current">₹${price}</span>
            ${mrp > price ? `<span class="price-mrp">₹${mrp}</span>` : ''}
            ${discount > 0 ? `<span class="price-discount">${discount}% OFF</span>` : ''}
          </div>
          ${product.in_stock === false ? `<div class="out-of-stock">Out of Stock</div>` : 
            inCart ? `
            <div class="qty-controls">
              <button class="qty-btn" onclick="event.stopPropagation(); updateCartQty('${product.id}', ${inCart.quantity - 1})">−</button>
              <span class="qty-value">${inCart.quantity}</span>
              <button class="qty-btn" onclick="event.stopPropagation(); updateCartQty('${product.id}', ${inCart.quantity + 1})">+</button>
            </div>
          ` : `
            <button class="add-to-cart-btn" onclick="event.stopPropagation(); addToCart('${product.id}', '${escapeJs(product.name)}', '${product.image || ''}', ${price}, ${mrp}, '${escapeJs(product.unit || '')}')">
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
    cart.push({ id, name, image, price: parseFloat(price), mrp: parseFloat(mrp), unit, quantity: 1 });
  }
  
  updateCartBadge();
  showToast('Added to cart!');
  refreshCurrentProducts();

  // Sync with backend (fire-and-forget)
  apiCall('/cart/add', 'POST', {
    product_id: id,
    product_name: name,
    product_image: image,
    price: parseFloat(price),
    mrp: parseFloat(mrp),
    unit,
    quantity: existing ? existing.quantity : 1,
  }).catch(() => {});
}

function updateCartQty(productId, newQty) {
  if (newQty <= 0) {
    cart = cart.filter(c => c.id !== productId);
    apiCall('/cart/remove', 'POST', { product_id: productId }).catch(() => {});
    showToast('Removed from cart');
  } else {
    const item = cart.find(c => c.id === productId);
    if (item) item.quantity = newQty;
    apiCall('/cart/update', 'POST', { product_id: productId, quantity: newQty }).catch(() => {});
  }
  
  updateCartBadge();
  refreshCurrentProducts();
  
  if (currentPage === 'cart') renderCart();
}

function renderCart() {
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

  container.innerHTML = cart.map(item => {
    const hasImage = item.image && item.image.startsWith('http');
    return `
    <div class="cart-item">
      <div class="cart-item-image">
        ${hasImage ? `<img src="${item.image}" alt="" width="60" height="60" style="border-radius:8px;object-fit:cover;">` : '📦'}
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-unit">${item.unit || ''}</div>
        <div class="cart-item-bottom">
          <span class="cart-item-price">₹${(item.price * item.quantity).toFixed(0)}</span>
          <div class="qty-controls">
            <button class="qty-btn" onclick="updateCartQty('${item.id}', ${item.quantity - 1})">−</button>
            <span class="qty-value">${item.quantity}</span>
            <button class="qty-btn" onclick="updateCartQty('${item.id}', ${item.quantity + 1})">+</button>
          </div>
        </div>
      </div>
    </div>
  `}).join('');

  // Update summary
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const savings = cart.reduce((sum, item) => sum + ((item.mrp - item.price) * item.quantity), 0);
  const delivery = subtotal > 500 ? 0 : 30;
  
  document.getElementById('cart-subtotal').textContent = `₹${subtotal.toFixed(0)}`;
  document.getElementById('cart-delivery').textContent = delivery === 0 ? 'FREE' : `₹${delivery}`;
  document.getElementById('cart-total').textContent = `₹${(subtotal + delivery).toFixed(0)}`;
  
  // Show savings if any
  const savingsEl = document.getElementById('cart-savings');
  if (savingsEl) {
    savingsEl.textContent = savings > 0 ? `You save ₹${savings.toFixed(0)}` : '';
    savingsEl.style.display = savings > 0 ? 'block' : 'none';
  }
}

function updateCartBadge() {
  cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const badge = document.getElementById('cart-badge');
  if (badge) {
    badge.textContent = cartCount;
    badge.style.display = cartCount > 0 ? 'flex' : 'none';
  }
}

function refreshCurrentProducts() {
  // Re-render products on current page to update add/qty buttons
  if (currentPage === 'home') loadHomePage();
}

// ==================== ORDERS ====================

async function loadOrders() {
  const container = document.getElementById('orders-list');
  const emptyState = document.getElementById('orders-empty');

  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading orders...</p></div>';
  emptyState.style.display = 'none';

  try {
    const data = await apiCall('/orders');
    if (data.orders && data.orders.length > 0) {
      emptyState.style.display = 'none';
      container.innerHTML = data.orders.map(order => `
        <div class="order-card">
          <div class="order-header">
            <span class="order-id">#${order.id}</span>
            <span class="order-status ${order.status?.toLowerCase() || ''}">${order.status || 'Processing'}</span>
          </div>
          <div class="order-meta">
            ${order.date ? `<span class="order-date">${formatDate(order.date)}</span>` : ''}
            <span class="order-items">${order.items_count || 0} items</span>
          </div>
          <div class="order-total">₹${order.total || 0}</div>
        </div>
      `).join('');
    } else {
      container.innerHTML = '';
      emptyState.style.display = 'block';
    }
  } catch (e) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
  }
}

// ==================== PROFILE ====================

function loadProfile() {
  if (tg?.initDataUnsafe?.user) {
    const user = tg.initDataUnsafe.user;
    document.getElementById('profile-name').textContent = 
      (user.first_name || '') + ' ' + (user.last_name || '');
  }
  
  // Show auth status
  const statusEl = document.getElementById('auth-status');
  if (statusEl) {
    statusEl.textContent = isAuthenticated ? '✅ Connected to BigBasket' : '⚠️ Not connected';
    statusEl.className = isAuthenticated ? 'auth-status connected' : 'auth-status disconnected';
  }
}

// ==================== CHECKOUT ====================

document.getElementById('checkout-btn')?.addEventListener('click', () => {
  if (cart.length === 0) return;
  
  if (tg) {
    tg.showConfirm('Place this order on BigBasket?', (confirmed) => {
      if (confirmed) placeOrder();
    });
  } else {
    if (confirm('Place this order?')) placeOrder();
  }
});

async function placeOrder() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  try {
    const result = await apiCall('/orders/place', 'POST', {
      items: cart.map(item => ({
        product_id: item.id,
        quantity: item.quantity,
        price: item.price,
      })),
      total: subtotal,
    });
    
    if (result.success || result.data) {
      cart = [];
      updateCartBadge();
      showToast('Order placed successfully! 🎉');
      navigateTo('orders');
    } else {
      showToast(result.error || 'Failed to place order');
    }
  } catch (e) {
    showToast('Order failed. Please try again.');
  }
}

// ==================== UTILITIES ====================

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJs(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\\/g, '\\\\');
}

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
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
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Logout button
document.getElementById('logout-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  if (tg) {
    tg.showConfirm('Logout from BigBasket?', (confirmed) => {
      if (confirmed) {
        sessionId = null;
        isAuthenticated = false;
        cart = [];
        updateCartBadge();
        showToast('Logged out');
        setTimeout(() => tg.close(), 1000);
      }
    });
  }
});

// ==================== DEFAULT DATA (Demo/Fallback) ====================

const DEFAULT_CATEGORIES = [
  { id: '1', name: 'Fruits & Vegetables', icon: '🥬' },
  { id: '2', name: 'Foodgrains & Oil', icon: '🌾' },
  { id: '3', name: 'Bakery & Dairy', icon: '🥛' },
  { id: '4', name: 'Beverages', icon: '🥤' },
  { id: '5', name: 'Snacks & Branded Foods', icon: '🍿' },
  { id: '6', name: 'Eggs, Meat & Fish', icon: '🥚' },
  { id: '7', name: 'Cleaning & Household', icon: '🧹' },
  { id: '8', name: 'Beauty & Hygiene', icon: '💄' },
  { id: '9', name: 'Baby Care', icon: '🍼' },
  { id: '10', name: 'Kitchen & Dining', icon: '🍳' },
  { id: '11', name: 'Gourmet & World Food', icon: '🧀' },
  { id: '12', name: 'Pet Care', icon: '🐕' },
];

const DEFAULT_PRODUCTS = [
  { id: 'p1', name: 'Organic Bananas', unit: '1 Dozen', price: 49, mrp: 60, image: '', category: '1', in_stock: true },
  { id: 'p2', name: 'Fresh Tomatoes', unit: '500 g', price: 29, mrp: 35, image: '', category: '1', in_stock: true },
  { id: 'p3', name: 'Amul Butter', unit: '100 g', price: 56, mrp: 58, image: '', category: '3', in_stock: true },
  { id: 'p4', name: 'Tata Tea Gold', unit: '500 g', price: 275, mrp: 310, image: '', category: '4', in_stock: true },
  { id: 'p5', name: 'Aashirvaad Atta', unit: '5 kg', price: 295, mrp: 340, image: '', category: '2', in_stock: true },
  { id: 'p6', name: 'Lay\'s Classic Salted', unit: '90 g', price: 20, mrp: 20, image: '', category: '5', in_stock: true },
  { id: 'p7', name: 'Amul Toned Milk', unit: '500 ml', price: 28, mrp: 30, image: '', category: '3', in_stock: true },
  { id: 'p8', name: 'Fresh Onions', unit: '1 kg', price: 35, mrp: 45, image: '', category: '1', in_stock: true },
  { id: 'p9', name: 'Farm Fresh Eggs', unit: '6 pcs', price: 54, mrp: 60, image: '', category: '6', in_stock: true },
  { id: 'p10', name: 'Coca-Cola', unit: '750 ml', price: 38, mrp: 40, image: '', category: '4', in_stock: true },
  { id: 'p11', name: 'Maggi 2-Minute Noodles', unit: '280 g (4 pack)', price: 52, mrp: 56, image: '', category: '5', in_stock: true },
  { id: 'p12', name: 'Sona Masoori Rice', unit: '5 kg', price: 399, mrp: 450, image: '', category: '2', in_stock: true },
];
