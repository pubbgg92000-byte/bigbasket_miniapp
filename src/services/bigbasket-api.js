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
 */
class BigBasketAPI {
  constructor(accessToken = null, visitorId = null) {
    this.client = axios.create({
      baseURL: BB_BASE_URL,
      timeout: 30000,
      headers: {
        ...DEFAULT_HEADERS,
        ...(accessToken && { 'X-BB-Token': accessToken }),
        ...(visitorId && { 'X-Visitor-Id': visitorId }),
      },
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error(`[BB-API] Error: ${error.response?.status} - ${error.config?.url}`);
        throw error;
      }
    );
  }

  // ==================== AUTHENTICATION ====================

  /**
   * Send OTP to phone number
   * @param {string} phoneNumber - 10-digit Indian phone number
   */
  async sendOTP(phoneNumber) {
    try {
      const response = await this.client.post(ENDPOINTS.AUTH.SEND_OTP, {
        phone_number: phoneNumber,
        type: 'otp',
        os_name: 'android',
        os_version: '13',
      });
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || 'Failed to send OTP',
        status: error.response?.status,
      };
    }
  }

  /**
   * Verify OTP and get access tokens
   * @param {string} phoneNumber - Phone number
   * @param {string} otp - 6-digit OTP
   */
  async verifyOTP(phoneNumber, otp) {
    try {
      const response = await this.client.post(ENDPOINTS.AUTH.VERIFY_OTP, {
        phone_number: phoneNumber,
        otp: otp,
        type: 'otp',
        os_name: 'android',
        os_version: '13',
      });

      const data = response.data;
      return {
        success: true,
        data: {
          accessToken: data.access_token || data.token,
          refreshToken: data.refresh_token,
          memberId: data.member_id || data.user_id,
          visitorId: data.visitor_id,
          userName: data.name || data.user_name,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || 'Invalid OTP',
        status: error.response?.status,
      };
    }
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
