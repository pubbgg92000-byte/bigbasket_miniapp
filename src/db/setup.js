/**
 * Database Setup Script
 * Run: npm run setup-db
 */
const fs = require('fs');
const path = require('path');
const { initDB } = require('./database');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('[SETUP] Created data/ directory');
}

// Initialize database
initDB();
console.log('[SETUP] Database setup complete!');
console.log(`[SETUP] Database location: ${path.join(dataDir, 'bigbasket.db')}`);
