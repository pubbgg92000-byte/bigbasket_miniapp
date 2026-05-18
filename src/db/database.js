const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/bigbasket.db');

let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDB() {
  const database = getDB();

  // Users table - stores Telegram user info & BigBasket session
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      phone_number TEXT,
      bb_access_token TEXT,
      bb_refresh_token TEXT,
      bb_member_id TEXT,
      bb_visitor_id TEXT,
      state TEXT DEFAULT 'idle',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Sessions table - active Mini App sessions
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      telegram_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
    );
  `);

  // Sections cache - stores home/category sections
  database.exec(`
    CREATE TABLE IF NOT EXISTS sections_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_type TEXT NOT NULL,
      section_key TEXT NOT NULL,
      data TEXT NOT NULL,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      UNIQUE(section_type, section_key)
    );
  `);

  // Cart cache - local cart state
  database.exec(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT,
      product_image TEXT,
      quantity INTEGER DEFAULT 1,
      price REAL,
      mrp REAL,
      unit TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
      UNIQUE(telegram_id, product_id)
    );
  `);

  // Order history
  database.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      order_id TEXT NOT NULL,
      status TEXT,
      total_amount REAL,
      item_count INTEGER,
      order_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
    );
  `);

  // Address cache
  database.exec(`
    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      address_id TEXT NOT NULL,
      label TEXT,
      full_address TEXT,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
      UNIQUE(telegram_id, address_id)
    );
  `);

  console.log('[DB] Database initialized successfully');
  return database;
}

// User operations
const userOps = {
  getUser(telegramId) {
    return getDB().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  },

  createUser(telegramId) {
    return getDB().prepare(
      'INSERT OR IGNORE INTO users (telegram_id) VALUES (?)'
    ).run(telegramId);
  },

  updateUserState(telegramId, state) {
    return getDB().prepare(
      'UPDATE users SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?'
    ).run(state, telegramId);
  },

  updateUserPhone(telegramId, phone) {
    return getDB().prepare(
      'UPDATE users SET phone_number = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?'
    ).run(phone, telegramId);
  },

  updateUserTokens(telegramId, { accessToken, refreshToken, memberId, visitorId }) {
    return getDB().prepare(`
      UPDATE users SET 
        bb_access_token = ?, 
        bb_refresh_token = ?, 
        bb_member_id = ?,
        bb_visitor_id = ?,
        state = 'authenticated',
        updated_at = CURRENT_TIMESTAMP 
      WHERE telegram_id = ?
    `).run(accessToken, refreshToken, memberId, visitorId, telegramId);
  },

  getUserBySession(sessionId) {
    return getDB().prepare(`
      SELECT u.* FROM users u 
      JOIN sessions s ON u.telegram_id = s.telegram_id 
      WHERE s.session_id = ? AND s.expires_at > datetime('now')
    `).get(sessionId);
  },

  clearUserSession(telegramId) {
    return getDB().prepare(`
      UPDATE users SET 
        bb_access_token = NULL, 
        bb_refresh_token = NULL,
        bb_member_id = NULL,
        state = 'idle',
        updated_at = CURRENT_TIMESTAMP 
      WHERE telegram_id = ?
    `).run(telegramId);
  }
};

// Session operations
const sessionOps = {
  createSession(sessionId, telegramId, expiresInHours = 24) {
    return getDB().prepare(`
      INSERT OR REPLACE INTO sessions (session_id, telegram_id, expires_at)
      VALUES (?, ?, datetime('now', '+' || ? || ' hours'))
    `).run(sessionId, telegramId, expiresInHours);
  },

  getSession(sessionId) {
    return getDB().prepare(
      'SELECT * FROM sessions WHERE session_id = ? AND expires_at > datetime(\'now\')'
    ).get(sessionId);
  },

  deleteSession(sessionId) {
    return getDB().prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  }
};

// Sections cache operations
const cacheOps = {
  getCache(sectionType, sectionKey) {
    return getDB().prepare(`
      SELECT data FROM sections_cache 
      WHERE section_type = ? AND section_key = ? AND expires_at > datetime('now')
    `).get(sectionType, sectionKey);
  },

  setCache(sectionType, sectionKey, data, expiresInMinutes = 30) {
    return getDB().prepare(`
      INSERT OR REPLACE INTO sections_cache (section_type, section_key, data, cached_at, expires_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+' || ? || ' minutes'))
    `).run(sectionType, sectionKey, JSON.stringify(data), expiresInMinutes);
  },

  clearCache(sectionType) {
    if (sectionType) {
      return getDB().prepare('DELETE FROM sections_cache WHERE section_type = ?').run(sectionType);
    }
    return getDB().prepare('DELETE FROM sections_cache').run();
  }
};

// Cart operations
const cartOps = {
  getCart(telegramId) {
    return getDB().prepare('SELECT * FROM cart_items WHERE telegram_id = ?').all(telegramId);
  },

  addToCart(telegramId, product) {
    return getDB().prepare(`
      INSERT OR REPLACE INTO cart_items (telegram_id, product_id, product_name, product_image, quantity, price, mrp, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(telegramId, product.id, product.name, product.image, product.quantity || 1, product.price, product.mrp, product.unit);
  },

  updateQuantity(telegramId, productId, quantity) {
    if (quantity <= 0) {
      return getDB().prepare('DELETE FROM cart_items WHERE telegram_id = ? AND product_id = ?').run(telegramId, productId);
    }
    return getDB().prepare(
      'UPDATE cart_items SET quantity = ? WHERE telegram_id = ? AND product_id = ?'
    ).run(quantity, telegramId, productId);
  },

  removeFromCart(telegramId, productId) {
    return getDB().prepare('DELETE FROM cart_items WHERE telegram_id = ? AND product_id = ?').run(telegramId, productId);
  },

  clearCart(telegramId) {
    return getDB().prepare('DELETE FROM cart_items WHERE telegram_id = ?').run(telegramId);
  }
};

module.exports = {
  getDB,
  initDB,
  userOps,
  sessionOps,
  cacheOps,
  cartOps,
};
