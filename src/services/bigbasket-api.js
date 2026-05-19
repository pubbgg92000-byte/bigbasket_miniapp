const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { BB_BASE_URL, DEFAULT_HEADERS, WEB_HEADERS, ENDPOINTS, BB_APP_VERSION, BB_BUILD_VERSION } = require('../config/constants');

/**
 * BigBasket API Service
 * 
 * Proxies requests to BigBasket's mobile API endpoints.
 * Based on captured traffic from BigBasket Android App v8.29.1
 * 
 * Captured patterns:
 * - App uses /mapi/v4.2.0/ prefix for mobile APIs
 * - App uses /ui-svc/v1/ and /ui-svc/v2/ for UI configuration
 * - Auth token is JWT containing mid, vid, TDLTOKEN, refresh_token
 * - Device info sent via /mapi/v4.2.0/update/device/info/
 * - Analytics via Snowplow to prod-collector.bigbasket.com
 */
class BigBasketAPI {
  /**
   * @param {string|null} accessToken - Full JWT token
   * @param {string|null} visitorId - Visitor ID (from JWT vid field)
   */
  constructor(accessToken = null, visitorId = null) {
    this.accessToken = accessToken;
    this.jwtPayload = accessToken ? this._decodeJWT(accessToken) : null;
    
    // Extract vid from JWT payload if not provided
    this.visitorId = visitorId || 
      (this.jwtPayload?.vid ? String(this.jwtPayload.vid) : this._generateVisitorId());
    
    // Extract member ID from JWT
    this.memberId = this.jwtPayload?.mid ? String(this.jwtPayload.mid) : null;
    
    // Extract TDLTOKEN from JWT (additional auth header)
    this.tdlToken = this.jwtPayload?.TDLTOKEN || null;

    // Build headers matching captured BigBasket Android traffic
    const headers = { ...DEFAULT_HEADERS };
    // Fresh tracker per request instance
    headers['X-Tracker'] = uuidv4();

    // Add auth headers when authenticated
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      headers['X-BB-Token'] = accessToken;
    }
    if (this.visitorId) {
      headers['X-Visitor-Id'] = this.visitorId;
    }
    if (this.tdlToken) {
      headers['X-TDLTOKEN'] = this.tdlToken;
    }
    if (this.memberId) {
      headers['X-Member-Id'] = this.memberId;
    }

    this.client = axios.create({
      baseURL: BB_BASE_URL,
      timeout: 30000,
      maxRedirects: 0,
      decompress: false,
      headers,
    });

    // Intercept requests to remove Accept-Encoding and log
    this.client.interceptors.request.use((config) => {
      delete config.headers['Accept-Encoding'];
      delete config.headers['accept-encoding'];
      console.log(`[BB-API] >> ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
      return config;
    });

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[BB-API] << ${response.status} ${response.config?.url} (${JSON.stringify(response.data).length} bytes)`);
        return response;
      },
      (error) => {
        console.error(`[BB-API] !! ERROR ${error.response?.status || 'NETWORK'} - ${error.config?.url}`);
        console.error(`[BB-API] !! ${JSON.stringify(error.response?.data || error.message).substring(0, 300)}`);
        throw error;
      }
    );
  }

  /**
   * Decode JWT payload (base64url decode the middle segment)
   */
  _decodeJWT(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      let payload = parts[1];
      payload = payload.replace(/-/g, '+').replace(/_/g, '/');
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
    return String(Math.floor(Math.random() * 9000000000000000000) + 1000000000000000000);
  }

  // ==================== AUTHENTICATION ====================

  /**
   * Send OTP to phone number using curl (bypasses TLS fingerprinting)
   * BigBasket's Akamai CDN fingerprints Node.js TLS and returns 500
   * Using curl with native TLS avoids this
   */
  async sendOTP(phoneNumber) {
    const cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    const { execSync } = require('child_process');
    const { v4: uuidv4 } = require('uuid');

    const channels = ['sms', 'voice'];

    for (const channel of channels) {
      try {
        const payload = JSON.stringify({ identifier: cleanPhone, channel, type: 'login' });
        const tracker = uuidv4();

        const curlCmd = `curl -s -X POST 'https://www.bigbasket.com/member-tdl/v3/member/otp/' ` +
          `-H 'Content-Type: application/json' ` +
          `-H 'Accept: application/json' ` +
          `-H 'User-Agent: Dalvik/2.1.0 (Linux; U; Android 13; SM-S911B Build/TP1A.220624.014)' ` +
          `-H 'X-Channel: BB-Android' ` +
          `-H 'X-Caller: app' ` +
          `-H 'X-App-Version: 8.29.1' ` +
          `-H 'X-Build-Version: 25110910' ` +
          `-H 'X-Tracker: ${tracker}' ` +
          `-H 'X-Entry-Context: hp' ` +
          `-H 'X-Entry-Context-Id: 1' ` +
          `-d '${payload}' -w '\\n%{http_code}' --max-time 15`;

        console.log(`[BB-API] Sending OTP via curl (${channel}): ${cleanPhone}`);
        const output = execSync(curlCmd, { encoding: 'utf-8', timeout: 20000 });
        const lines = output.trim().split('\n');
        const httpCode = parseInt(lines[lines.length - 1]);
        const body = lines.slice(0, -1).join('\n').trim();

        console.log(`[BB-API] OTP response (${channel}): HTTP ${httpCode} - ${body.substring(0, 150)}`);

        if (httpCode === 200) {
          let data = {};
          try { data = JSON.parse(body); } catch (e) {}
          return { success: true, data: { ...data, channel }, endpoint: '/member-tdl/v3/member/otp/' };
        }

        if (httpCode === 400) {
          let errorData = {};
          try { errorData = JSON.parse(body); } catch (e) {}
          const errors = errorData.errors || [];
          const errorCode = errors[0]?.code_str || '';
          const errorMsg = errors[0]?.msg || errors[0]?.display_msg || '';

          if (errorCode === 'HU4001') {
            return { success: false, error: 'This phone number is not registered with BigBasket.', code: errorCode };
          }
          if (errorCode === 'HU4012') {
            return { success: false, error: 'Invalid mobile number format. Enter a valid 10-digit number.', code: errorCode };
          }
          if (errorCode === 'HU4002') {
            return { success: false, error: errorMsg || 'Too many OTP attempts. Try again later.', code: errorCode };
          }
          if (errorCode && errorCode !== 'HU4000') {
            return { success: false, error: errorMsg || `Error: ${errorCode}`, code: errorCode };
          }
          // HU4000 = invalid format, try next channel
          console.log(`[BB-API] Got HU4000 on ${channel}, trying next`);
        }

        if (httpCode === 500) {
          console.log(`[BB-API] Got 500 on ${channel} - rate limited, trying next channel`);
          // Try next channel
        }
      } catch (e) {
        console.error(`[BB-API] curl error (${channel}):`, e.message?.substring(0, 100));
      }
    }

    return {
      success: false,
      error: 'OTP sending is temporarily blocked (rate limited). Please wait 10-15 minutes and try again.',
    };
  }

  /**
   * Verify OTP via unified-login endpoint
   * CONFIRMED from live testing: POST /member-tdl/v3/member/otp/
   * With type="verify" - returns 500 on wrong OTP (server crash), 200 with JWT on correct OTP
   * Also try unified-login as fallback
   */
  async verifyOTP(phoneNumber, otp) {
    const cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    const { execSync } = require('child_process');
    const { v4: uuidv4 } = require('uuid');

    const attempts = [
      { url: '/member-tdl/v3/member/otp/', payload: { identifier: cleanPhone, otp, channel: 'sms', type: 'verify' } },
      { url: '/member-tdl/v3/member/otp/', payload: { identifier: cleanPhone, code: otp, channel: 'sms', type: 'verify' } },
      { url: '/member-tdl/v3/member/unified-login/', payload: { identifier: cleanPhone, otp, channel: 'sms', type: 'verify' } },
    ];

    for (const attempt of attempts) {
      try {
        const payload = JSON.stringify(attempt.payload);
        const tracker = uuidv4();

        const curlCmd = `curl -s -X POST 'https://www.bigbasket.com${attempt.url}' ` +
          `-H 'Content-Type: application/json' ` +
          `-H 'Accept: application/json' ` +
          `-H 'User-Agent: Dalvik/2.1.0 (Linux; U; Android 13; SM-S911B Build/TP1A.220624.014)' ` +
          `-H 'X-Channel: BB-Android' ` +
          `-H 'X-Caller: app' ` +
          `-H 'X-App-Version: 8.29.1' ` +
          `-H 'X-Build-Version: 25110910' ` +
          `-H 'X-Tracker: ${tracker}' ` +
          `-H 'X-Entry-Context: hp' ` +
          `-H 'X-Entry-Context-Id: 1' ` +
          `-d '${payload}' -w '\\n%{http_code}' --max-time 15`;

        console.log(`[BB-API] Verify OTP via curl: ${attempt.url} payload: ${payload}`);
        const output = execSync(curlCmd, { encoding: 'utf-8', timeout: 20000 });
        const lines = output.trim().split('\n');
        const httpCode = parseInt(lines[lines.length - 1]);
        const body = lines.slice(0, -1).join('\n').trim();

        console.log(`[BB-API] Verify response: HTTP ${httpCode} - ${body.substring(0, 300)}`);

        if (httpCode === 200) {
          let data = {};
          try { data = JSON.parse(body); } catch (e) {}

          // Extract token
          const accessToken = data.access_token || data.token || data.auth_token ||
                             data.member?.access_token || data.data?.access_token;

          if (accessToken) {
            const jwtPayload = this._decodeJWT(accessToken);
            return {
              success: true,
              data: {
                accessToken,
                refreshToken: jwtPayload?.refresh_token || data.refresh_token || null,
                memberId: String(jwtPayload?.mid || data.member_id || ''),
                visitorId: jwtPayload?.vid ? String(jwtPayload.vid) : this.visitorId,
                userName: data.name || data.user_name || data.member?.name || 'User',
              },
            };
          }

          // Success without explicit token
          return {
            success: true,
            data: {
              accessToken: data.token || data.session_token || 'session_token',
              refreshToken: null,
              memberId: data.member_id || '',
              visitorId: this.visitorId,
              userName: data.name || 'User',
            },
          };
        }

        if (httpCode === 400) {
          let errorData = {};
          try { errorData = JSON.parse(body); } catch (e) {}
          const errors = errorData.errors || [];
          const errorCode = errors[0]?.code_str || '';
          const errorMsg = errors[0]?.msg || errors[0]?.display_msg || '';

          if (errorCode === 'HU4011') {
            return { success: false, error: errorMsg || 'Invalid OTP. Please try again.' };
          }
          if (errorCode && errorCode !== 'HU4000') {
            return { success: false, error: errorMsg || `Verification failed: ${errorCode}` };
          }
          // HU4000 = wrong format, try next
        }

        if (httpCode === 500) {
          return { success: false, error: 'Invalid OTP. Please check the code and try again.' };
        }
      } catch (e) {
        console.error(`[BB-API] Verify curl error:`, e.message?.substring(0, 100));
      }
    }

    return { success: false, error: 'OTP verification failed. Please try again.' };
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

  // ==================== UI SERVICE (from captured traffic) ====================

  /**
   * Get header/door info
   * Captured: GET /ui-svc/v2/header/?send_door_info=true&send_pseudo_door=true&...
   */
  async getHeaderInfo() {
    try {
      const response = await this.client.get(ENDPOINTS.UI_SERVICE.HEADER, {
        params: {
          send_door_info: true,
          send_pseudo_door: true,
          send_order_restriction_enabled_door: true,
          app_launch: true,
          address_change: false,
          send_address_set_by_user: true,
          'enable-pharma-door': true,
          free_cash_context: '',
        },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch header info' };
    }
  }

  /**
   * Get full app data (categories, config, layout)
   * Captured: GET /ui-svc/v1/app-data?os_name=android&app_version=8.29.1
   * Response: 33.6kb of app configuration including categories
   */
  async getAppData() {
    try {
      const response = await this.client.get(ENDPOINTS.UI_SERVICE.APP_DATA, {
        params: {
          os_name: 'android',
          app_version: BB_APP_VERSION,
        },
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch app data' };
    }
  }

  // ==================== HOME & NAVIGATION ====================

  /**
   * Get home page data (banners, sections, offers)
   */
  async getHomePage() {
    try {
      // Try the UI service endpoint first (from captured traffic)
      const appData = await this.getAppData();
      if (appData.success) {
        return appData;
      }
      // Fallback to mapi endpoint
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
      // Fallback: try to get from app-data
      try {
        const appData = await this.getAppData();
        if (appData.success && appData.data) {
          // Extract categories from app-data response
          const categories = appData.data.categories || 
                           appData.data.tabs?.find(t => t.type === 'category')?.data ||
                           appData.data.data?.categories;
          if (categories) {
            return { success: true, data: { categories } };
          }
        }
      } catch (e) {}
      return { success: false, error: 'Failed to fetch categories' };
    }
  }

  /**
   * Get sub-categories for a category
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

  async placeOrder(orderData) {
    try {
      const response = await this.client.post(ENDPOINTS.ORDER.PLACE, orderData);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to place order' };
    }
  }

  // ==================== ADDRESS ====================

  async getAddresses() {
    try {
      const response = await this.client.get(ENDPOINTS.ADDRESS.LIST);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch addresses' };
    }
  }

  // ==================== DELIVERY SLOTS ====================

  async getAvailableSlots() {
    try {
      const response = await this.client.get(ENDPOINTS.SLOT.AVAILABLE);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch slots' };
    }
  }

  // ==================== OFFERS ====================

  async getOffers() {
    try {
      const response = await this.client.get(ENDPOINTS.OFFERS.LIST);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to fetch offers' };
    }
  }

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

  // ==================== DEVICE REGISTRATION (captured) ====================

  /**
   * Register device info with BigBasket
   * Captured: POST /mapi/v4.2.0/update/device/info/
   */
  async registerDevice() {
    try {
      const response = await this.client.post(ENDPOINTS.DEVICE.UPDATE_INFO, {
        device_id: 'android_' + this.visitorId?.substring(0, 16),
        os_name: 'android',
        os_version: '13',
        app_version: BB_APP_VERSION,
        build_version: BB_BUILD_VERSION,
        device_model: 'SM-S911B',
        device_manufacturer: 'samsung',
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Failed to register device' };
    }
  }

  // ==================== HEALTH CHECK ====================

  async healthCheck() {
    try {
      const response = await this.client.get(ENDPOINTS.HEALTH.CHECK);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: 'Health check failed' };
    }
  }
}

module.exports = BigBasketAPI;
