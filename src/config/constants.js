/**
 * BigBasket API Configuration
 * Reverse-engineered from BigBasket Android App & Web traffic
 * 
 * TOKEN FORMAT: BigBasket uses self-contained JWTs (HS256 signed)
 * The JWT payload contains ALL auth info:
 *   - mid: Member ID (numeric)
 *   - vid: Visitor ID (19-digit numeric)
 *   - TDLTOKEN: UUID session token
 *   - refresh_token: UUID for token refresh
 *   - device_id: "WEB" | "ANDROID" | "IOS"
 *   - source_id: 1 (web)
 *   - exp: Unix timestamp expiry
 * 
 * HEADERS: When authenticated, BigBasket expects:
 *   - Authorization: Bearer <jwt>
 *   - X-BB-Token: <jwt> (same token, redundant but required)
 *   - X-Visitor-Id: <vid from jwt>
 *   - X-Member-Id: <mid from jwt> (optional)
 *   - X-TDLTOKEN: <TDLTOKEN from jwt> (optional)
 *   - Cookie: _bb_token=<jwt>; _bb_vid=<vid>; _bb_mid=<mid>
 * 
 * IMPORTANT: BigBasket frequently rotates API paths and adds new anti-bot headers.
 * If OTP fails, you MUST capture fresh traffic. See /capture command in bot.
 */

module.exports = {
  // Base configuration
  BB_BASE_URL: process.env.BB_BASE_URL || 'https://www.bigbasket.com',
  BB_API_VERSION: process.env.BB_API_VERSION || 'v3.1.0',
  BB_CHANNEL: process.env.BB_CHANNEL || 'web',
  
  // Default headers mimic the BigBasket web client (based on captured traffic)
  // Web client is easier to replicate than Android app (no SSL pinning)
  DEFAULT_HEADERS: {
    'User-Agent': process.env.BB_USER_AGENT || 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://www.bigbasket.com',
    'Referer': 'https://www.bigbasket.com/',
    'X-Channel': process.env.BB_CHANNEL || 'web',
    'X-Caller': 'page',
    'X-Entry-Context': 'hp',
    'X-Entry-Context-Id': '1',
    'X-Tracker': '',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  },

  // Android app headers (fallback if web headers get blocked)
  ANDROID_HEADERS: {
    'User-Agent': 'BigBasket/7.10.2 (Android; SDK 33; arm64-v8a)',
    'X-Channel': 'bb-android',
    'X-Caller': 'app',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-App-Version': '7.10.2',
    'X-Build-Version': '25800',
    'X-Entry-Context': 'hp',
    'X-Entry-Context-Id': '1',
    'X-Tracker': '',
    'Accept-Language': 'en-IN',
    'Accept-Encoding': 'gzip, deflate, br',
  },

  // API Endpoint paths
  // Override via env vars if you capture fresh endpoints from mitmproxy
  ENDPOINTS: {
    // Authentication
    AUTH: {
      SEND_OTP: process.env.BB_SEND_OTP_PATH || '/mapi/v3.1.0/login/send-otp/',
      VERIFY_OTP: process.env.BB_VERIFY_OTP_PATH || '/mapi/v3.1.0/login/verify-otp/',
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
