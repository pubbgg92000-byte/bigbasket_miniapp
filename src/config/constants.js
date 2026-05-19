/**
 * BigBasket API Configuration
 * Based on real captured traffic from BigBasket Android App v8.29.1
 * 
 * Captured endpoints from mitmproxy interception:
 * - Base: https://www.bigbasket.com
 * - UI Service: /ui-svc/v1/ and /ui-svc/v2/
 * - Mobile API: /mapi/v4.2.0/
 * - Analytics: prod-collector.bigbasket.com (snowplow)
 * - Third party: MoEngage, Incognia, Firebase
 * 
 * TOKEN FORMAT: BigBasket uses self-contained JWTs (HS256 signed)
 * The JWT payload contains ALL auth info:
 *   - mid: Member ID (numeric)
 *   - vid: Visitor ID (19-digit numeric)
 *   - TDLTOKEN: UUID session token
 *   - refresh_token: UUID for token refresh
 *   - device_id: "ANDROID"
 *   - source_id: 2 (android)
 *   - exp: Unix timestamp expiry
 */

module.exports = {
  // Base configuration
  BB_BASE_URL: process.env.BB_BASE_URL || 'https://www.bigbasket.com',
  BB_API_VERSION: process.env.BB_API_VERSION || 'v4.2.0',
  BB_CHANNEL: process.env.BB_CHANNEL || 'bb-android',
  BB_APP_VERSION: '8.29.1',
  BB_BUILD_VERSION: '25110910',

  // Android App headers (captured from real traffic - BigBasket v8.29.1)
  DEFAULT_HEADERS: {
    'User-Agent': process.env.BB_USER_AGENT || 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S911B Build/TP1A.220624.014)',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Language': 'en-IN,en;q=0.9',
    'X-Channel': process.env.BB_CHANNEL || 'bb-android',
    'X-Caller': 'app',
    'X-Entry-Context': 'hp',
    'X-Entry-Context-Id': '1',
    'X-Tracker': require('uuid').v4(),
    'X-App-Version': '8.29.1',
    'X-Build-Version': '25110910',
    'Connection': 'keep-alive',
  },

  // Web headers (fallback - for browser-based access)
  WEB_HEADERS: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://www.bigbasket.com',
    'Referer': 'https://www.bigbasket.com/',
    'X-Channel': 'web',
    'X-Caller': 'page',
    'X-Entry-Context': 'hp',
    'X-Entry-Context-Id': '1',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  },

  // API Endpoint paths (captured from BigBasket v8.29.1 real traffic)
  ENDPOINTS: {
    // ========== AUTHENTICATION (CONFIRMED from HTTP Toolkit capture 2026-05-19) ==========
    AUTH: {
      // Send OTP - CONFIRMED: POST /member-tdl/v3/member/otp/
      // First call may return 400 if validation fails, 200 on success
      SEND_OTP: process.env.BB_SEND_OTP_PATH || '/member-tdl/v3/member/otp/',
      // Verify OTP / Login - CONFIRMED: POST /member-tdl/v3/member/unified-login/
      // Returns 400 with code HU4011 on wrong OTP, 200 with JWT on success
      VERIFY_OTP: process.env.BB_VERIFY_OTP_PATH || '/member-tdl/v3/member/unified-login/',
      // Legacy alias (both endpoints are used in the flow)
      UNIFIED_LOGIN: '/member-tdl/v3/member/unified-login/',
      OTP_ENDPOINT: '/member-tdl/v3/member/otp/',
      REFRESH_TOKEN: '/member-tdl/v3/member/refresh-token/',
      LOGOUT: '/member-tdl/v3/member/logout/',
    },

    // ========== UI SERVICE (CONFIRMED from real captured traffic) ==========
    UI_SERVICE: {
      // GET /ui-svc/v2/header/ - Door info, address, delivery config (CONFIRMED)
      HEADER: '/ui-svc/v2/header/',
      // GET /ui-svc/v1/app-data - Full app config, categories, layout (CONFIRMED)
      APP_DATA: '/ui-svc/v1/app-data',
      // GET /ui-svc/v1/member/details - Member profile, wallet (CONFIRMED)
      MEMBER_DETAILS: '/ui-svc/v1/member/details',
      // POST /ui-svc/v1/set-current-delivery-address (CONFIRMED from error analytics)
      SET_ADDRESS: '/ui-svc/v1/set-current-delivery-address',
      // GET /ui-svc/v1/serviceable/ (CONFIRMED from error analytics)
      SERVICEABLE: '/ui-svc/v1/serviceable/',
      // GET /ui-svc/v1/page/dynamic (CONFIRMED from app-data allowed_apis_to_trace)
      DYNAMIC_PAGE: '/ui-svc/v1/page/dynamic',
    },

    // ========== LISTING SERVICE (CONFIRMED from app-data allowed_apis_to_trace) ==========
    LISTING: {
      SHORT_LIST: '/listing-svc/v1/short-list',
      WIDGET: '/listing-svc/v2/widget',
      SHORT_LIST_PRODUCTS: '/listing-svc/v1/short-list-products',
    },

    // ========== HOME & NAVIGATION ==========
    HOME: {
      // Home page data
      PAGE: '/mapi/v4.2.0/home/page/',
      // Banners/offers carousel
      BANNERS: '/mapi/v4.2.0/home/banners/',
      // Top picks / recommended
      TOP_PICKS: '/mapi/v4.2.0/home/top-picks/',
      // Personalised sections
      SECTIONS: '/mapi/v4.2.0/home/sections/',
    },

    // ========== CATEGORIES ==========
    CATEGORY: {
      // All categories list
      LIST: '/mapi/v4.2.0/category/list/',
      // Sub-categories under a parent
      SUB_CATEGORY: '/mapi/v4.2.0/category/sub-category/',
      // Products in a category
      PRODUCTS: '/mapi/v4.2.0/category/products/',
    },

    // ========== PRODUCTS ==========
    PRODUCT: {
      // Product listing
      LIST: '/mapi/v4.2.0/product/list/',
      // Product detail
      DETAIL: '/mapi/v4.2.0/product/detail/',
      // Search products
      SEARCH: '/mapi/v4.2.0/product/search/',
      // Search suggestions/autocomplete
      SUGGESTIONS: '/mapi/v4.2.0/product/search-suggestions/',
    },

    // ========== CART ==========
    CART: {
      // Get cart contents
      GET: '/mapi/v4.2.0/cart/get/',
      // Add item to cart
      ADD: '/mapi/v4.2.0/cart/add/',
      // Remove item from cart
      REMOVE: '/mapi/v4.2.0/cart/remove/',
      // Update item quantity
      UPDATE_QTY: '/mapi/v4.2.0/cart/update-qty/',
      // Clear entire cart
      CLEAR: '/mapi/v4.2.0/cart/clear/',
    },

    // ========== ORDERS ==========
    ORDER: {
      // Order history
      LIST: '/mapi/v4.2.0/order/list/',
      // Order detail
      DETAIL: '/mapi/v4.2.0/order/detail/',
      // Place order
      PLACE: '/mapi/v4.2.0/order/place/',
      // Cancel order
      CANCEL: '/mapi/v4.2.0/order/cancel/',
      // Track order
      TRACK: '/mapi/v4.2.0/order/track/',
    },

    // ========== ADDRESS ==========
    ADDRESS: {
      LIST: '/mapi/v4.2.0/address/list/',
      ADD: '/mapi/v4.2.0/address/add/',
      DELETE: '/mapi/v4.2.0/address/delete/',
      SET_DEFAULT: '/mapi/v4.2.0/address/set-default/',
    },

    // ========== DELIVERY SLOTS ==========
    SLOT: {
      AVAILABLE: '/mapi/v4.2.0/slot/available/',
      SELECT: '/mapi/v4.2.0/slot/select/',
    },

    // ========== OFFERS & WALLET ==========
    OFFERS: {
      LIST: '/mapi/v4.2.0/offers/list/',
      APPLY_COUPON: '/mapi/v4.2.0/offers/apply-coupon/',
      REMOVE_COUPON: '/mapi/v4.2.0/offers/remove-coupon/',
    },

    WALLET: {
      BALANCE: '/mapi/v4.2.0/wallet/balance/',
    },

    // ========== DEVICE & TRACKING (captured) ==========
    DEVICE: {
      // POST /mapi/v4.2.0/update/device/info/ - Register device
      UPDATE_INFO: '/mapi/v4.2.0/update/device/info/',
    },

    // ========== HEALTH CHECK (captured) ==========
    HEALTH: {
      CHECK: '/service/healthcheck.html',
    },
  },

  // Third-party services detected in traffic
  THIRD_PARTY: {
    SNOWPLOW_COLLECTOR: 'https://prod-collector.bigbasket.com/com.snowplowanalytics.snowplow/tp2',
    MOENGAGE: 'https://sdk-01.moengage.com',
    INCOGNIA: 'https://service1.us.incognia.com',
    FIREBASE_CONFIG: 'https://firebaseremoteconfig.googleapis.com',
  },

  // User states for the bot conversation flow
  USER_STATES: {
    IDLE: 'idle',
    AWAITING_PHONE: 'awaiting_phone',
    AWAITING_OTP: 'awaiting_otp',
    AUTHENTICATED: 'authenticated',
  },
};
