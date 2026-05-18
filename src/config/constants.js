/**
 * BigBasket API Configuration
 * Reverse-engineered from BigBasket Android App v7.10.x
 * 
 * These endpoints mirror the mobile app's HTTP traffic patterns.
 * Headers simulate the Android client for API compatibility.
 */

module.exports = {
  // Base configuration
  BB_BASE_URL: process.env.BB_BASE_URL || 'https://www.bigbasket.com',
  BB_API_VERSION: process.env.BB_API_VERSION || 'v3.1.0',
  BB_CHANNEL: process.env.BB_CHANNEL || 'bb-android',
  
  // Headers that mimic the Android app
  DEFAULT_HEADERS: {
    'User-Agent': process.env.BB_USER_AGENT || 'BigBasket/7.10.2 (Android; SDK 33; arm64-v8a)',
    'X-Channel': 'bb-android',
    'X-Caller': 'app',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-App-Version': '7.10.2',
    'X-Build-Version': '25800',
    'X-Entry-Context': 'hp',
    'X-Entry-Context-Id': '1',
    'X-Tracker': '',
  },

  // API Endpoint paths
  ENDPOINTS: {
    // Authentication
    AUTH: {
      SEND_OTP: '/mapi/v3.1.0/login/send-otp/',
      VERIFY_OTP: '/mapi/v3.1.0/login/verify-otp/',
      REFRESH_TOKEN: '/mapi/v3.1.0/login/refresh-token/',
      LOGOUT: '/mapi/v3.1.0/login/logout/',
    },

    // Home & Navigation
    HOME: {
      PAGE: '/mapi/v3.1.0/home/page/',
      BANNERS: '/mapi/v3.1.0/home/banners/',
      TOP_PICKS: '/mapi/v3.1.0/home/top-picks/',
    },

    // Categories
    CATEGORY: {
      LIST: '/mapi/v3.1.0/category/list/',
      SUB_CATEGORY: '/mapi/v3.1.0/category/sub-category/',
      PRODUCTS: '/mapi/v3.1.0/category/products/',
    },

    // Products
    PRODUCT: {
      LIST: '/mapi/v3.1.0/product/list/',
      DETAIL: '/mapi/v3.1.0/product/detail/',
      SEARCH: '/mapi/v3.1.0/product/search/',
      SUGGESTIONS: '/mapi/v3.1.0/product/search-suggestions/',
    },

    // Cart
    CART: {
      GET: '/mapi/v3.1.0/cart/get/',
      ADD: '/mapi/v3.1.0/cart/add/',
      REMOVE: '/mapi/v3.1.0/cart/remove/',
      UPDATE_QTY: '/mapi/v3.1.0/cart/update-qty/',
      CLEAR: '/mapi/v3.1.0/cart/clear/',
    },

    // Orders
    ORDER: {
      LIST: '/mapi/v3.1.0/order/list/',
      DETAIL: '/mapi/v3.1.0/order/detail/',
      PLACE: '/mapi/v3.1.0/order/place/',
      CANCEL: '/mapi/v3.1.0/order/cancel/',
      TRACK: '/mapi/v3.1.0/order/track/',
    },

    // Address
    ADDRESS: {
      LIST: '/mapi/v3.1.0/address/list/',
      ADD: '/mapi/v3.1.0/address/add/',
      DELETE: '/mapi/v3.1.0/address/delete/',
      SET_DEFAULT: '/mapi/v3.1.0/address/set-default/',
    },

    // Slot / Delivery
    SLOT: {
      AVAILABLE: '/mapi/v3.1.0/slot/available/',
      SELECT: '/mapi/v3.1.0/slot/select/',
    },

    // Offers & Wallet
    OFFERS: {
      LIST: '/mapi/v3.1.0/offers/list/',
      APPLY_COUPON: '/mapi/v3.1.0/offers/apply-coupon/',
      REMOVE_COUPON: '/mapi/v3.1.0/offers/remove-coupon/',
    },

    WALLET: {
      BALANCE: '/mapi/v3.1.0/wallet/balance/',
    },
  },

  // User states for the bot conversation flow
  USER_STATES: {
    IDLE: 'idle',
    AWAITING_PHONE: 'awaiting_phone',
    AWAITING_OTP: 'awaiting_otp',
    AUTHENTICATED: 'authenticated',
  },
};
