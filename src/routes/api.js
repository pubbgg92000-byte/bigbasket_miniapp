const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const BigBasketAPI = require('../services/bigbasket-api');
const { userOps, sessionOps, cacheOps, cartOps } = require('../db/database');

/**
 * Middleware: Extract and validate session
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
 * Public: Create session for Mini App (called from Telegram WebApp init)
 */
router.post('/session/create', (req, res) => {
  const { telegram_id, init_data } = req.body;

  if (!telegram_id) {
    return res.status(400).json({ error: 'telegram_id required' });
  }

  const user = userOps.getUser(parseInt(telegram_id));
  if (!user || !user.bb_access_token) {
    return res.status(401).json({ error: 'Not authenticated. Please login via bot.' });
  }

  const sessionId = uuidv4();
  sessionOps.createSession(sessionId, parseInt(telegram_id));

  res.json({
    success: true,
    session_id: sessionId,
    user: {
      phone: user.phone_number,
      member_id: user.bb_member_id,
    },
  });
});

/**
 * Auth status check
 */
router.get('/auth/status', authMiddleware, (req, res) => {
  res.json({
    authenticated: true,
    phone: req.user.phone_number,
    member_id: req.user.bb_member_id,
  });
});

// ==================== HOME ====================

router.get('/home', authMiddleware, async (req, res) => {
  try {
    // Check cache first
    const cached = cacheOps.getCache('home', 'page');
    if (cached) {
      return res.json(JSON.parse(cached.data));
    }

    const result = await req.bbApi.getHomePage();
    if (result.success) {
      cacheOps.setCache('home', 'page', result.data, 15); // Cache 15 min
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch home page' });
  }
});

router.get('/banners', authMiddleware, async (req, res) => {
  try {
    const cached = cacheOps.getCache('home', 'banners');
    if (cached) return res.json(JSON.parse(cached.data));

    const result = await req.bbApi.getBanners();
    if (result.success) {
      cacheOps.setCache('home', 'banners', result.data, 30);
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

// ==================== CATEGORIES ====================

router.get('/categories', authMiddleware, async (req, res) => {
  try {
    const cached = cacheOps.getCache('category', 'list');
    if (cached) return res.json(JSON.parse(cached.data));

    const result = await req.bbApi.getCategories();
    if (result.success) {
      cacheOps.setCache('category', 'list', result.data, 60); // Cache 1 hour
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
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
    if (result.success) {
      res.json(result.data);
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
    if (result.success) {
      res.json(result.data);
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
    // Get both remote cart and local cache
    const result = await req.bbApi.getCart();
    if (result.success) {
      res.json(result.data);
    } else {
      // Fallback to local cart
      const localCart = cartOps.getCart(req.user.telegram_id);
      res.json({ items: localCart, source: 'local' });
    }
  } catch (error) {
    const localCart = cartOps.getCart(req.user.telegram_id);
    res.json({ items: localCart, source: 'local' });
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
      res.json(result.data);
    } else {
      res.json({ success: true, source: 'local', message: 'Added to local cart' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to cart' });
  }
});

router.post('/cart/remove', authMiddleware, async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id required' });

    const result = await req.bbApi.removeFromCart(product_id);
    cartOps.removeFromCart(req.user.telegram_id, product_id);

    res.json(result.success ? result.data : { success: true, source: 'local' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from cart' });
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

    res.json(result.success ? result.data : { success: true, source: 'local' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update cart' });
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
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
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
      // Clear local cart on successful order
      cartOps.clearCart(req.user.telegram_id);
      res.json(result.data);
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
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

// ==================== DELIVERY SLOTS ====================

router.get('/slots', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getAvailableSlots();
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch slots' });
  }
});

// ==================== OFFERS ====================

router.get('/offers', authMiddleware, async (req, res) => {
  try {
    const result = await req.bbApi.getOffers();
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch offers' });
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
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to apply coupon' });
  }
});

module.exports = router;
