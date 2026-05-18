const axios = require('axios');
const { BB_BASE_URL, DEFAULT_HEADERS, ENDPOINTS } = require('../config/constants');

/**
 * BigBasket API Service
 * 
 * Proxies requests to BigBasket's mobile API endpoints.
 * Mimics the Android app's HTTP traffic patterns including:
 * - Custom headers (User-Agent, X-Channel, X-Caller)
 * - Authentication token handling
 * - Request/Response transformation
 * 
 * NOTE: BigBasket frequently changes their API paths and adds new security headers.
 * If requests fail, you need to:
 * 1. Intercept fresh traffic from the BigBasket Android APK using mitmproxy/Frida
 * 2. Update endpoints in config/constants.js
 * 3. Update headers (especially X-Tracker, cookies, fingerprint)
 */
class BigBasketAPI {
  /**
   * @param {string|null} accessToken - Full JWT token (contains mid, vid, TDLTOKEN, refresh_token inside)
   * @param {string|null} visitorId - Visitor ID (extracted from JWT vid field or auto-generated)
   * 
   * BigBasket JWT Payload Structure:
   * {
   *   "chaff": "random_string",
   *   "time": 1739099619.3279107,
   *   "mid": 13758350,           // Member ID
   *   "vid": 1254087522695103232, // Visitor ID (numeric)
   *   "device_id": "WEB",
   *   "source_id": 1,
   *   "ec_list": [3,4,10,...],    // Enabled channel list
   *   "TDLTOKEN": "uuid",        // TDL session token
   *   "refresh_token": "uuid",   // For token refresh
   *   "tdl_expiry": 1779704418,
   *   "exp": 1794879619,         // Token expiry timestamp
   *   "device_model": "WEB",
   *   "is_internal_user": false
   * }
   */
  constructor(accessToken = null, visitorId = null) {
    this.accessToken = accessToken;
    this.jwtPayload = accessToken ? this._decodeJWT(accessToken) : null;
    
    // Extract vid from JWT payload if not provided
    this.visitorId = visitorId || 
      (this.jwtPayload?.vid ? String(this.jwtPayload.vid) : this._generateVisitorId());
    
    // Extract member ID from JWT
    this.memberId = this.jwtPayload?.mid ? String(this.jwtPayload.mid) : null;
    
    // Extract TDLTOKEN from JWT (used as additional auth header)
    this.tdlToken = this.jwtPayload?.TDLTOKEN || null;

    // Build headers matching BigBasket web client behavior
    const headers = {
      ...DEFAULT_HEADERS,
      'X-Visitor-Id': this.visitorId,
    };

    // When authenticated, BigBasket web uses these headers
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      headers['X-BB-Token'] = accessToken;
    }
    if (this.tdlToken) {
      headers['X-TDLTOKEN'] = this.tdlToken;
    }
    if (this.memberId) {
      headers['X-Member-Id'] = this.memberId;
    }

    // Cookie-style auth (BigBasket web uses cookies alongside headers)
    if (accessToken) {
      headers['Cookie'] = `_bb_token=${accessToken}; _bb_vid=${this.visitorId}; _bb_mid=${this.memberId || ''}`;
    }

    this.client = axios.create({
      baseURL: BB_BASE_URL,
      timeout: 30000,
      headers,
    });

    // Request interceptor - log all outgoing requests
    this.client.interceptors.request.use((config) => {
      console.log(`[BB-API] >> ${config.method?.toUpperCase()} ${config.url}`);
      if (config.data) console.log(`[BB-API] >> Body:`, JSON.stringify(config.data));
      return config;
    });

    // Response interceptor - log all responses for debugging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[BB-API] << ${response.status} ${response.config?.url}`);
        console.log(`[BB-API] << Response:`, JSON.stringify(response.data).substring(0, 500));
        return response;
      },
      (error) => {
        console.error(`[BB-API] !! ERROR ${error.response?.status} - ${error.config?.url}`);
        console.error(`[BB-API] !! Response:`, JSON.stringify(error.response?.data || error.message));
        throw error;
      }
    );
  }

  /**
   * Decode JWT payload (base64url decode the middle segment)
   * No verification needed - we just need the claims
   */
  _decodeJWT(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      // Base64url decode the payload
      let payload = parts[1];
      payload = payload.replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if needed
      while (payload.length % 4) payload += '=';
      
      const decoded = Buffer.from(payload, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch (e) {
      console.error('[BB-API] Failed to decode JWT:', e.message);
      return null;
    }
  }

  /**
   * Check if the current token is expired
   */
  isTokenExpired() {
    if (!this.jwtPayload?.exp) return true;
    return Date.now() / 1000 > this.jwtPayload.exp;
  }

  /**
   * Get token info for debugging
   */
  getTokenInfo() {
    if (!this.jwtPayload) return null;
    return {
      memberId: this.jwtPayload.mid,
      visitorId: this.jwtPayload.vid,
      deviceId: this.jwtPayload.device_id,
      tdlToken: this.jwtPayload.TDLTOKEN,
      expiresAt: new Date(this.jwtPayload.exp * 1000).toISOString(),
      isExpired: this.isTokenExpired(),
    };
  }

  _generateVisitorId() {
    // BigBasket uses a large numeric visitor ID (19 digits)
    return String(Math.floor(Math.random() * 9000000000000000000) + 1000000000000000000);
  }

  // ==================== AUTHENTICATION ====================

  /**
   * Send OTP to phone number
   * BigBasket login endpoints (try multiple known patterns):
   * - /mapi/v3.1.0/login/send-otp/  (older Android builds)
   * - /auth/login/otp/send/          (newer web/app API)  
   * - /mapi/v4.0.0/login/otp-send/   (v4 migration)
   * 
   * @param {string} phoneNumber - 10-digit Indian phone number
   */
  async sendOTP(phoneNumber) {
    // Build multiple endpoint attempts (BigBasket changes these frequently)
    const attempts = [
      {
        url: ENDPOINTS.AUTH.SEND_OTP,
        payload: {
          login_id: phoneNumber,
          login_type: 2,  // 2 = phone number
          type: 'otp',
        },
      },
      {
        url: '/auth/login/',
        payload: {
          number: `+91${phoneNumber}`,
          type: 'otp',
          otp_type: 'sms',
        },
      },
      {
        url: '/mapi/v4.0.0/auth/login-otp/',
        payload: {
          mobile: phoneNumber,
          country_code: '+91',
          loginType: 'otp',
        },
      },
      {
        url: '/api/v2/member/login/otp-send/',
        payload: {
          mobile_number: phoneNumber,
          country_code: '91',
        },
      },
    ];

    for (const attempt of attempts) {
      try {
        console.log(`[BB-API] Trying OTP endpoint: ${attempt.url}`);
        const response = await this.client.post(attempt.url, attempt.payload);
        
        // Check various success indicators BigBasket might use
        if (response.data && 
            (response.data.status === 'success' || 
             response.data.success === true || 
             response.data.status === 0 ||
             response.data.response_code === 200 ||
             response.status === 200)) {
          console.log(`[BB-API] OTP sent successfully via ${attempt.url}`);
          return { success: true, data: response.data, endpoint: attempt.url };
        }
      } catch (error) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        console.log(`[BB-API] Endpoint ${attempt.url} failed: ${status} - ${JSON.stringify(errorData)}`);
        
        // If we get 404, try next. If we get 4xx with a message, that's the real endpoint
        if (status && status !== 404 && status !== 405 && errorData?.message) {
          return {
            success: false,
            error: errorData.message || `Failed (HTTP ${status})`,
            status,
            endpoint: attempt.url,
            raw: errorData,
          };
        }
        // Continue to next attempt
      }
    }

    return {
      success: false,
      error: 'All OTP endpoints failed. You need to capture fresh API traffic from the BigBasket APK. See README for instructions.',
      status: 0,
    };
  }

  /**
   * Verify OTP and get access tokens
   * @param {string} phoneNumber - Phone number
   * @param {string} otp - 6-digit OTP
   * @param {string} endpoint - The endpoint that worked for sendOTP (to match verify path)
   */
  async verifyOTP(phoneNumber, otp, endpoint = null) {
    const attempts = [
      {
        url: ENDPOINTS.AUTH.VERIFY_OTP,
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          otp: otp,
          type: 'otp',
        },
      },
      {
        url: '/auth/login/verify/',
        payload: {
          number: `+91${phoneNumber}`,
          otp: otp,
        },
      },
      {
        url: '/mapi/v4.0.0/auth/verify-otp/',
        payload: {
          mobile: phoneNumber,
          country_code: '+91',
          otp: otp,
        },
      },
      {
        url: '/api/v2/member/login/otp-verify/',
        payload: {
          mobile_number: phoneNumber,
          country_code: '91',
          otp: otp,
        },
      },
    ];

    for (const attempt of attempts) {
      try {
        console.log(`[BB-API] Trying verify endpoint: ${attempt.url}`);
        const response = await this.client.post(attempt.url, attempt.payload);
        const data = response.data;

        // BigBasket returns a JWT token that contains mid, vid, refresh_token in the payload
        const accessToken = data.access_token || data.token || data.auth_token || 
                           data.member?.access_token || data.data?.access_token;

        if (accessToken) {
          // Decode the JWT to extract embedded credentials
          const jwtPayload = this._decodeJWT(accessToken);
          const memberId = jwtPayload?.mid || data.member_id || data.user_id || data.mid;
          const visitorId = jwtPayload?.vid ? String(jwtPayload.vid) : (data.visitor_id || this.visitorId);
          const refreshToken = jwtPayload?.refresh_token || data.refresh_token;
          const userName = data.name || data.user_name || data.member?.name || data.first_name || 'User';

          console.log(`[BB-API] Auth successful via ${attempt.url} | mid=${memberId} vid=${visitorId}`);
          return {
            success: true,
            data: { accessToken, refreshToken, memberId: String(memberId), visitorId, userName },
          };
        }

        // Some endpoints return success but with nested data
        if (data.status === 'success' || data.success === true) {
          const nestedToken = data.token || data.session_token;
          const jwtPayload = nestedToken ? this._decodeJWT(nestedToken) : null;
          return {
            success: true,
            data: {
              accessToken: nestedToken || 'token_from_response',
              refreshToken: jwtPayload?.refresh_token || data.refresh_token || null,
              memberId: String(jwtPayload?.mid || data.member_id || data.id || ''),
              visitorId: jwtPayload?.vid ? String(jwtPayload.vid) : this.visitorId,
              userName: data.name || 'User',
            },
          };
        }
      } catch (error) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        console.log(`[BB-API] Verify ${attempt.url} failed: ${status} - ${JSON.stringify(errorData)}`);
        
        if (status && status !== 404 && status !== 405 && errorData?.message) {
          return {
            success: false,
            error: errorData.message || `Verification failed (HTTP ${status})`,
            status,
            raw: errorData,
          };
        }
      }
    }

    return {
      success: false,
      error: 'OTP verification failed on all endpoints. Ensure OTP was correct and try /login again.',
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken) {
    try {
      const response = await this.client.post(ENDPOINTS.AUTH.REFRESH_TOKEN, {
        refresh_token: refreshToken,
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Token refresh failed' };
    }
  }

  // ==================== HOME & NAVIGATION ====================

  /**
   * Get home page data (banners, sections, offers)
   */
  async getHomePage() {
    try {
      const response = await this.client.get(ENDPOINTS.HOME.PAGE);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch home page' };
    }
  }

  /**
   * Get promotional banners
   */
  async getBanners() {
    try {
      const response = await this.client.get(ENDPOINTS.HOME.BANNERS);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch banners' };
    }
  }

  // ==================== CATEGORIES ====================

  /**
   * Get all categories
   */
  async getCategories() {
    try {
      const response = await this.client.get(ENDPOINTS.CATEGORY.LIST);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch categories' };
    }
  }

  /**
   * Get sub-categories for a category
   * @param {string} categoryId - Parent category ID
   */
  async getSubCategories(categoryId) {
    try {
      const response = await this.client.get(ENDPOINTS.CATEGORY.SUB_CATEGORY, {
        params: { category_id: categoryId },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch sub-categories' };
    }
  }

  /**
   * Get products by category
   * @param {string} categoryId - Category ID
   * @param {number} page - Page number
   */
  async getCategoryProducts(categoryId, page = 1) {
    try {
      const response = await this.client.get(ENDPOINTS.CATEGORY.PRODUCTS, {
        params: { category_id: categoryId, page, page_size: 20 },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch category products' };
    }
  }

  // ==================== PRODUCTS ====================

  /**
   * Search products
   * @param {string} query - Search query
   * @param {number} page - Page number
   */
  async searchProducts(query, page = 1) {
    try {
      const response = await this.client.get(ENDPOINTS.PRODUCT.SEARCH, {
        params: { q: query, page, page_size: 20 },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to search products' };
    }
  }

  /**
   * Get product details
   * @param {string} productId - Product ID / SKU
   */
  async getProductDetail(productId) {
    try {
      const response = await this.client.get(ENDPOINTS.PRODUCT.DETAIL, {
        params: { product_id: productId },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch product details' };
    }
  }

  /**
   * Get search suggestions
   * @param {string} query - Partial search query
   */
  async getSearchSuggestions(query) {
    try {
      const response = await this.client.get(ENDPOINTS.PRODUCT.SUGGESTIONS, {
        params: { q: query },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch suggestions' };
    }
  }

  // ==================== CART ====================

  /**
   * Get current cart
   */
  async getCart() {
    try {
      const response = await this.client.get(ENDPOINTS.CART.GET);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch cart' };
    }
  }

  /**
   * Add item to cart
   * @param {string} productId - Product ID
   * @param {number} quantity - Quantity
   */
  async addToCart(productId, quantity = 1) {
    try {
      const response = await this.client.post(ENDPOINTS.CART.ADD, {
        product_id: productId,
        quantity,
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to add to cart' };
    }
  }

  /**
   * Remove item from cart
   * @param {string} productId - Product ID
   */
  async removeFromCart(productId) {
    try {
      const response = await this.client.post(ENDPOINTS.CART.REMOVE, {
        product_id: productId,
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to remove from cart' };
    }
  }

  /**
   * Update cart item quantity
   * @param {string} productId - Product ID
   * @param {number} quantity - New quantity
   */
  async updateCartQuantity(productId, quantity) {
    try {
      const response = await this.client.post(ENDPOINTS.CART.UPDATE_QTY, {
        product_id: productId,
        quantity,
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to update quantity' };
    }
  }

  // ==================== ORDERS ====================

  /**
   * Get order history
   */
  async getOrders(page = 1) {
    try {
      const response = await this.client.get(ENDPOINTS.ORDER.LIST, {
        params: { page, page_size: 10 },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch orders' };
    }
  }

  /**
   * Get order details
   * @param {string} orderId - Order ID
   */
  async getOrderDetail(orderId) {
    try {
      const response = await this.client.get(ENDPOINTS.ORDER.DETAIL, {
        params: { order_id: orderId },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch order details' };
    }
  }

  /**
   * Place order
   * @param {object} orderData - Order payload
   */
  async placeOrder(orderData) {
    try {
      const response = await this.client.post(ENDPOINTS.ORDER.PLACE, orderData);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to place order' };
    }
  }

  // ==================== ADDRESS ====================

  /**
   * Get saved addresses
   */
  async getAddresses() {
    try {
      const response = await this.client.get(ENDPOINTS.ADDRESS.LIST);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch addresses' };
    }
  }

  // ==================== DELIVERY SLOTS ====================

  /**
   * Get available delivery slots
   */
  async getAvailableSlots() {
    try {
      const response = await this.client.get(ENDPOINTS.SLOT.AVAILABLE);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch slots' };
    }
  }

  // ==================== OFFERS ====================

  /**
   * Get available offers
   */
  async getOffers() {
    try {
      const response = await this.client.get(ENDPOINTS.OFFERS.LIST);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch offers' };
    }
  }

  /**
   * Apply coupon code
   * @param {string} couponCode - Coupon code
   */
  async applyCoupon(couponCode) {
    try {
      const response = await this.client.post(ENDPOINTS.OFFERS.APPLY_COUPON, {
        coupon_code: couponCode,
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to apply coupon' };
    }
  }
}

module.exports = BigBasketAPI;
