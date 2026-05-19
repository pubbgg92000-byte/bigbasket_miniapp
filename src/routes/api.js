const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const BigBasketAPI = require('../services/bigbasket-api');
const { userOps, accountOps, sessionOps, cacheOps, cartOps } = require('../db/database');
const { validateInitData } = require('../utils/telegram-auth');

/**
 * Middleware: Extract and validate session
 * Checks for auth via session ID or telegram ID
 */
function authMiddleware(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.query.session_id;
  const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;

  if (telegramId) {
    const user = userOps.getUser(parseInt(telegramId));
    if (user && user.bb_access_token) {
      req.user = user;
      req.bbApi = new BigBasketAPI(user.bb_access_token, user.bb_visitor_id);
      return next();
    }
  }

  if (sessionId) {
    const user = userOps.getUserBySession(sessionId);
    if (user && user.bb_access_token) {
      req.user = user;
      req.bbApi = new BigBasketAPI(user.bb_access_token, user.bb_visitor_id);
      return next();
    }
  }

  return res.status(401).json({ error: 'Unauthorized. Please login via Telegram bot.' });
}

/**
 * Optional auth - allows unauthenticated access with limited functionality
 */
function optionalAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.query.session_id;
  const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;

  if (telegramId) {
    const user = userOps.getUser(parseInt(telegramId));
    if (user && user.bb_access_token) {
      req.user = user;
      req.bbApi = new BigBasketAPI(user.bb_access_token, user.bb_visitor_id);
    }
  } else if (sessionId) {
    const user = userOps.getUserBySession(sessionId);
    if (user && user.bb_access_token) {
      req.user = user;
      req.bbApi = new BigBasketAPI(user.bb_access_token, user.bb_visitor_id);
    }
  }

  // Create a guest API instance if no auth
  if (!req.bbApi) {
    req.bbApi = new BigBasketAPI();
  }

  next();
}

// ==================== SESSION ====================

/**
 * Create session for Mini App (called from Telegram WebApp init)
 * Validates Telegram initData for security when available
 */
router.post('/session/create', (req, res) => {
  const { telegram_id, init_data } = req.body;

  if (!telegram_id) {
    return res.status(400).json({ error: 'telegram_id required' });
  }

  // Validate Telegram initData if provided (security check)
  if (init_data) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const validation = validateInitData(init_data, botToken);
    
    if (!validation.valid) {
      console.log(`[API] initData validation failed: ${validation.error}`);
      // In production, you'd reject here. For dev, we log and continue.
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Invalid Telegram authentication' });
      }
    } else {
      console.log(`[API] Telegram user verified: ${validation.user?.id}`);
    }
  }

  const user = userOps.getUser(parseInt(telegram_id));
  if (!user || !user.bb_access_token) {
    return res.status(401).json({ 
      error: 'Not authenticated. Please login via bot first.',
      action: 'login_required',
    });
  }

  const sessionId = uuidv4();
  sessionOps.createSession(sessionId, parseInt(telegram_id));

  res.json({
    success: true,
    session_id: sessionId,
    user: {
      phone: user.phone_number,
      member_id: user.bb_member_id,
      name: user.name || 'User',
    },
  });
});

/**
 * Auth status check
 */
router.get('/auth/status', authMiddleware, (req, res) => {
  const bbApi = new BigBasketAPI(req.user.bb_access_token);
  const tokenInfo = bbApi.getTokenInfo();
  
  res.json({
    authenticated: true,
    phone: req.user.phone_number,
    member_id: req.user.bb_member_id,
    token_expired: tokenInfo?.isExpired || false,
    expires_at: tokenInfo?.expiresAt || null,
  });
});

// ==================== HOME ====================

router.get('/home', optionalAuth, async (req, res) => {
  try {
    // Check cache first (5 min TTL)
    const cached = cacheOps.getCache('home', 'page');
    if (cached) {
      return res.json(JSON.parse(cached.data));
    }

    const result = await req.bbApi.getHomePage();
    if (result.success && result.data) {
      // Normalize the response for the frontend
      const normalized = normalizeHomeData(result.data);
      cacheOps.setCache('home', 'page', normalized, 5);
      return res.json(normalized);
    }
    
    res.status(500).json({ error: result.error || 'Failed to fetch home page' });
  } catch (error) {
    console.error('[API] Home error:', error.message);
    res.status(500).json({ error: 'Failed to fetch home page' });
  }
});

router.get('/banners', optionalAuth, async (req, res) => {
  try {
    const cached = cacheOps.getCache('home', 'banners');
    if (cached) return res.json(JSON.parse(cached.data));

    const result = await req.bbApi.getBanners();
    if (result.success) {
      cacheOps.setCache('home', 'banners', result.data, 15);
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

// ==================== CATEGORIES ====================

router.get('/categories', optionalAuth, async (req, res) => {
  try {
    const cached = cacheOps.getCache('category', 'list');
    if (cached) return res.json(JSON.parse(cached.data));

    const result = await req.bbApi.getCategories();
    if (result.success && result.data) {
      // Normalize categories response
      const normalized = normalizeCategoriesData(result.data);
      cacheOps.setCache('category', 'list', normalized, 60);
      return res.json(normalized);
    }
    
    res.status(500).json({ error: result.error || 'Failed to fetch categories' });
  } catch (error) {
    console.error('[API] Categories error:', error.message);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.get('/categories/:id/sub', authMiddleware, async (req, res) => {
  try {
    const categoryId = req.params.id;
    const cached = cacheOps.getCache('category', `sub_${categoryId}`);
    if (cached) return res.json(JSON.parse(cached.data));

    const result = await req.bbApi.getSubCategories(categoryId);
    if (result.success) {
      cacheOps.setCache('category', `sub_${categoryId}`, result.data, 60);
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sub-categories' });
  }
});

router.get('/categories/:id/products', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1 } = req.query;
    const result = await req.bbApi.getCategoryProducts(id, page);
    if (result.success && result.data) {
      const normalized = normalizeProductsData(result.data);
      res.json(normalized);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// ==================== PRODUCTS ====================

router.get('/products/search', authMiddleware, async (req, res) => {
  try {
    const { q, page = 1 } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query required' });

    const result = await req.bbApi.searchProducts(q, page);
    if (result.success && result.data) {
      const normalized = normalizeProductsData(result.data);
      res.json(normalized);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/products/suggestions', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });

    const result = await req.bbApi.getSearchSuggestions(q);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

router.get('/products/:id', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getProductDetail(req.params.id);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// ==================== CART ====================

router.get('/cart', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getCart();
    if (result.success && result.data) {
      const normalized = normalizeCartData(result.data);
      res.json(normalized);
    } else {
      // Fallback to local cart
      const localCart = cartOps.getCart(req.user.telegram_id);
      res.json({ items: localCart, total: calculateCartTotal(localCart), source: 'local' });
    }
  } catch (error) {
    const localCart = cartOps.getCart(req.user.telegram_id);
    res.json({ items: localCart, total: calculateCartTotal(localCart), source: 'local' });
  }
});

router.post('/cart/add', authMiddleware, async (req, res) => {
  try {
    const { product_id, quantity = 1, product_name, product_image, price, mrp, unit } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id required' });

    // Add to BigBasket cart
    const result = await req.bbApi.addToCart(product_id, quantity);
    
    // Also cache locally
    cartOps.addToCart(req.user.telegram_id, {
      id: product_id,
      name: product_name,
      image: product_image,
      quantity,
      price,
      mrp,
      unit,
    });

    if (result.success) {
      res.json({ success: true, data: result.data, source: 'remote' });
    } else {
      res.json({ success: true, source: 'local', message: 'Added to local cart' });
    }
  } catch (error) {
    // Still save locally
    const { product_id, quantity = 1, product_name, product_image, price, mrp, unit } = req.body;
    if (product_id) {
      cartOps.addToCart(req.user.telegram_id, {
        id: product_id, name: product_name, image: product_image, quantity, price, mrp, unit,
      });
    }
    res.json({ success: true, source: 'local', message: 'Added to local cart' });
  }
});

router.post('/cart/remove', authMiddleware, async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id required' });

    const result = await req.bbApi.removeFromCart(product_id);
    cartOps.removeFromCart(req.user.telegram_id, product_id);

    res.json({ success: true, source: result.success ? 'remote' : 'local' });
  } catch (error) {
    const { product_id } = req.body;
    if (product_id) cartOps.removeFromCart(req.user.telegram_id, product_id);
    res.json({ success: true, source: 'local' });
  }
});

router.post('/cart/update', authMiddleware, async (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    if (!product_id || quantity === undefined) {
      return res.status(400).json({ error: 'product_id and quantity required' });
    }

    const result = await req.bbApi.updateCartQuantity(product_id, quantity);
    cartOps.updateQuantity(req.user.telegram_id, product_id, quantity);

    res.json({ success: true, source: result.success ? 'remote' : 'local' });
  } catch (error) {
    const { product_id, quantity } = req.body;
    if (product_id) cartOps.updateQuantity(req.user.telegram_id, product_id, quantity);
    res.json({ success: true, source: 'local' });
  }
});

router.post('/cart/clear', authMiddleware, async (req, res) => {
  try {
    cartOps.clearCart(req.user.telegram_id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

// ==================== ORDERS ====================

router.get('/orders', authMiddleware, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const result = await req.bbApi.getOrders(page);
    if (result.success && result.data) {
      const normalized = normalizeOrdersData(result.data);
      res.json(normalized);
    } else {
      res.json({ orders: [], total: 0 });
    }
  } catch (error) {
    res.json({ orders: [], total: 0 });
  }
});

router.get('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getOrderDetail(req.params.id);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

router.post('/orders/place', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.placeOrder(req.body);
    if (result.success) {
      cartOps.clearCart(req.user.telegram_id);
      res.json({ success: true, data: result.data });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// ==================== ADDRESS ====================

router.get('/addresses', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getAddresses();
    if (result.success) {
      res.json(result.data);
    } else {
      res.json({ addresses: [] });
    }
  } catch (error) {
    res.json({ addresses: [] });
  }
});

// ==================== DELIVERY SLOTS ====================

router.get('/slots', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getAvailableSlots();
    if (result.success) {
      res.json(result.data);
    } else {
      res.json({ slots: [] });
    }
  } catch (error) {
    res.json({ slots: [] });
  }
});

// ==================== OFFERS ====================

router.get('/offers', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getOffers();
    if (result.success) {
      res.json(result.data);
    } else {
      res.json({ offers: [] });
    }
  } catch (error) {
    res.json({ offers: [] });
  }
});

router.post('/offers/apply', authMiddleware, async (req, res) => {
  try {
    const { coupon_code } = req.body;
    if (!coupon_code) return res.status(400).json({ error: 'coupon_code required' });

    const result = await req.bbApi.applyCoupon(coupon_code);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to apply coupon' });
  }
});

// ==================== HEALTH CHECK ====================

router.get('/health', async (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ==================== DATA NORMALIZATION HELPERS ====================

/**
 * Normalize home page data from BigBasket's various response formats
 */
function normalizeHomeData(data) {
  const result = {
    categories: [],
    products: [],
    banners: [],
    sections: [],
  };

  // BigBasket app-data response has tabs, sections, categories in various structures
  if (data.tabs) {
    // Extract categories from tabs
    const categoryTab = data.tabs.find(t => t.type === 'category' || t.slug === 'category');
    if (categoryTab?.data) {
      result.categories = normalizeCategoryArray(categoryTab.data);
    }
  }

  if (data.categories) {
    result.categories = normalizeCategoryArray(data.categories);
  }

  if (data.banners || data.top_banners || data.carousel) {
    const banners = data.banners || data.top_banners || data.carousel || [];
    result.banners = banners.map(b => ({
      id: b.id || b.banner_id,
      image: b.image || b.img_url || b.banner_image,
      url: b.url || b.deeplink || b.action_url,
      title: b.title || b.alt_text || '',
    }));
  }

  if (data.sections || data.widgets) {
    const sections = data.sections || data.widgets || [];
    for (const section of sections) {
      if (section.products || section.items || section.data?.products) {
        const products = section.products || section.items || section.data?.products || [];
        result.products.push(...normalizeProductArray(products));
      }
    }
  }

  if (data.products) {
    result.products = normalizeProductArray(data.products);
  }

  // If we still have no products, try top-level data
  if (result.products.length === 0 && data.data?.products) {
    result.products = normalizeProductArray(data.data.products);
  }

  return result;
}

/**
 * Normalize categories response
 */
function normalizeCategoriesData(data) {
  let categories = [];
  
  if (Array.isArray(data)) {
    categories = data;
  } else if (data.categories) {
    categories = data.categories;
  } else if (data.data?.categories) {
    categories = data.data.categories;
  } else if (data.tabs) {
    const catTab = data.tabs.find(t => t.type === 'category');
    categories = catTab?.data || [];
  }

  return { categories: normalizeCategoryArray(categories) };
}

function normalizeCategoryArray(categories) {
  if (!Array.isArray(categories)) return [];
  return categories.map(cat => ({
    id: String(cat.id || cat.category_id || cat.tlc_id || cat.slug || ''),
    name: cat.name || cat.category_name || cat.title || 'Category',
    icon: cat.icon || cat.image || cat.img_url || cat.icon_url || '📦',
    image: cat.image || cat.img_url || cat.icon_url || cat.banner_image || '',
    slug: cat.slug || cat.url_slug || '',
    count: cat.count || cat.product_count || 0,
  }));
}

/**
 * Normalize products response
 */
function normalizeProductsData(data) {
  let products = [];
  let total = 0;
  let page = 1;

  if (Array.isArray(data)) {
    products = data;
  } else if (data.products) {
    products = data.products;
    total = data.total || data.total_count || products.length;
    page = data.page || data.current_page || 1;
  } else if (data.data?.products) {
    products = data.data.products;
    total = data.data.total || products.length;
  } else if (data.items) {
    products = data.items;
    total = data.total || products.length;
  }

  return {
    products: normalizeProductArray(products),
    total,
    page,
    has_more: products.length >= 20,
  };
}

function normalizeProductArray(products) {
  if (!Array.isArray(products)) return [];
  return products.map(p => ({
    id: String(p.id || p.product_id || p.sku || p.item_id || ''),
    name: p.name || p.product_name || p.desc || p.title || 'Product',
    unit: p.unit || p.weight || p.pack_size || p.quantity_text || '',
    price: parseFloat(p.price || p.sp || p.sale_price || p.selling_price || 0),
    mrp: parseFloat(p.mrp || p.market_price || p.original_price || p.price || 0),
    image: p.image || p.img_url || p.image_url || p.product_image || p.images?.[0] || '',
    brand: p.brand || p.brand_name || '',
    in_stock: p.in_stock !== false && p.availability !== 'out_of_stock',
    discount: p.discount || p.offer_text || calculateDiscount(p),
    category_id: String(p.category_id || p.tlc_id || ''),
  }));
}

function calculateDiscount(product) {
  const price = parseFloat(product.price || product.sp || product.sale_price || 0);
  const mrp = parseFloat(product.mrp || product.market_price || 0);
  if (mrp > price && price > 0) {
    return Math.round((1 - price / mrp) * 100) + '% OFF';
  }
  return '';
}

/**
 * Normalize cart response
 */
function normalizeCartData(data) {
  let items = [];
  let total = 0;

  if (data.items || data.cart_items || data.products) {
    const rawItems = data.items || data.cart_items || data.products || [];
    items = rawItems.map(item => ({
      id: String(item.id || item.product_id || item.sku || ''),
      name: item.name || item.product_name || item.desc || '',
      unit: item.unit || item.weight || item.pack_size || '',
      price: parseFloat(item.price || item.sp || item.sale_price || 0),
      mrp: parseFloat(item.mrp || item.market_price || 0),
      quantity: parseInt(item.quantity || item.qty || item.no_of_units || 1),
      image: item.image || item.img_url || item.product_image || '',
    }));
  }

  total = data.total || data.cart_total || data.sub_total || 
          items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  return {
    items,
    total,
    item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    delivery_charge: data.delivery_charge || data.delivery_fee || 0,
    savings: data.savings || data.total_savings || 0,
  };
}

/**
 * Normalize orders response
 */
function normalizeOrdersData(data) {
  let orders = [];

  if (Array.isArray(data)) {
    orders = data;
  } else if (data.orders) {
    orders = data.orders;
  } else if (data.data?.orders) {
    orders = data.data.orders;
  }

  return {
    orders: orders.map(order => ({
      id: order.id || order.order_id || order.order_number || '',
      status: order.status || order.order_status || 'processing',
      total: parseFloat(order.total || order.order_total || order.amount || 0),
      items_count: order.items_count || order.item_count || order.no_of_items || 0,
      date: order.date || order.order_date || order.created_at || '',
      delivery_date: order.delivery_date || order.expected_delivery || '',
    })),
    total: orders.length,
  };
}

/**
 * Calculate cart total from local items
 */
function calculateCartTotal(items) {
  return items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
}

module.exports = router;
