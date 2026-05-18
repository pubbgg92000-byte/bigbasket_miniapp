const axios = require('axios');
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
      headers,
    });

    // Request interceptor for logging
    this.client.interceptors.request.use((config) => {
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
   * Send OTP to phone number
   * Confirmed: POST /member-tdl/v3/member/unified-login/
   * This is a unified endpoint that handles both OTP send and verify
   * Error code HU4011 = invalid OTP (HTTP 400)
   * Analytics shows: Action="mobile OTP", EventSubGroup="login", flow="easyonboarding"
   */
  async sendOTP(phoneNumber) {
    const attempts = [
      // Confirmed unified-login endpoint (from analytics error decode)
      {
        url: ENDPOINTS.AUTH.UNIFIED_LOGIN,
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          type: 'otp',
          action: 'send_otp',
        },
      },
      // Same endpoint, different body format
      {
        url: ENDPOINTS.AUTH.UNIFIED_LOGIN,
        payload: {
          loginId: phoneNumber,
          loginType: 'otp',
          otpType: 'sms',
          action: 'send',
        },
      },
      // Same endpoint, minimal format
      {
        url: ENDPOINTS.AUTH.UNIFIED_LOGIN,
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          otp_type: 'sms',
        },
      },
      // Fallback: try older mapi endpoint
      {
        url: '/mapi/v4.2.0/login/send-otp/',
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          type: 'otp',
        },
      },
    ];

    for (const attempt of attempts) {
      try {
        console.log(`[BB-API] Trying OTP endpoint: ${attempt.url}`);
        const response = await this.client.post(attempt.url, attempt.payload);
        
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
        
        if (status && status !== 404 && status !== 405 && errorData?.message) {
          return {
            success: false,
            error: errorData.message || `Failed (HTTP ${status})`,
            status,
            endpoint: attempt.url,
            raw: errorData,
          };
        }
      }
    }

    return {
      success: false,
      error: 'All OTP endpoints failed. Capture fresh traffic from BigBasket app.',
    };
  }

  /**
   * Verify OTP via unified-login endpoint
   * Confirmed: POST /member-tdl/v3/member/unified-login/
   * Error "Please Enter Valid OTP." with code HU4011 on wrong OTP
   */
  async verifyOTP(phoneNumber, otp) {
    const attempts = [
      // Confirmed unified-login endpoint
      {
        url: ENDPOINTS.AUTH.UNIFIED_LOGIN,
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          otp: otp,
          type: 'otp',
          action: 'verify_otp',
        },
      },
      // Same endpoint, different format
      {
        url: ENDPOINTS.AUTH.UNIFIED_LOGIN,
        payload: {
          loginId: phoneNumber,
          loginType: 'otp',
          otp: otp,
          action: 'verify',
        },
      },
      // Same endpoint, minimal
      {
        url: ENDPOINTS.AUTH.UNIFIED_LOGIN,
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          otp: otp,
        },
      },
      // Fallback older endpoint
      {
        url: '/mapi/v4.2.0/login/verify-otp/',
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          otp: otp,
          type: 'otp',
        },
      },
      {
        url: '/mapi/v4.2.0/login/verify-otp/',
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          otp: otp,
          type: 'otp',
        },
      },
      {
        url: '/mapi/v3.1.0/login/verify-otp/',
        payload: {
          login_id: phoneNumber,
          login_type: 2,
          otp: otp,
          type: 'otp',
        },
      },
    ];

    for (const attempt of attempts) {
      try {
        console.log(`[BB-API] Trying verify endpoint: ${attempt.url}`);
        const response = await this.client.post(attempt.url, attempt.payload);
        const data = response.data;

        // Extract token from response (BigBasket uses various field names)
        const accessToken = data.access_token || data.token || data.auth_token || 
                           data.member?.access_token || data.data?.access_token ||
                           data.response?.access_token;

        if (accessToken) {
          const jwtPayload = this._decodeJWT(accessToken);
          const memberId = jwtPayload?.mid || data.member_id || data.user_id || data.mid;
          const visitorId = jwtPayload?.vid ? String(jwtPayload.vid) : (data.visitor_id || this.visitorId);
          const refreshToken = jwtPayload?.refresh_token || data.refresh_token;
          const userName = data.name || data.user_name || data.member?.name || data.first_name || 'User';

          console.log(`[BB-API] Auth successful | mid=${memberId} vid=${visitorId}`);
          return {
            success: true,
            data: { accessToken, refreshToken, memberId: String(memberId || ''), visitorId, userName },
          };
        }

        // Check if response indicates success with different structure
        if (data.status === 'success' || data.success === true || data.status === 0) {
          const nestedToken = data.token || data.session_token || data.data?.token;
          const jwtPayload = nestedToken ? this._decodeJWT(nestedToken) : null;
          return {
            success: true,
            data: {
              accessToken: nestedToken || 'session_token',
              refreshToken: jwtPayload?.refresh_token || null,
              memberId: String(jwtPayload?.mid || data.member_id || ''),
              visitorId: jwtPayload?.vid ? String(jwtPayload.vid) : this.visitorId,
              userName: data.name || 'User',
            },
          };
        }
      } catch (error) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        console.log(`[BB-API] Verify ${attempt.url} failed: ${status}`);
        
        if (status && status !== 404 && status !== 405 && errorData?.message) {
          return {
            success: false,
            error: errorData.message || `Verification failed (HTTP ${status})`,
          };
        }
      }
    }

    return {
      success: false,
      error: 'OTP verification failed. Check OTP and try /login again.',
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
