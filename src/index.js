require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initBot } = require('./bot/telegram');
const apiRoutes = require('./routes/api');
const { initDB } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Mini App static files
app.use('/miniapp', express.static(path.join(__dirname, '../public')));

// API Routes (proxy to BigBasket)
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database
initDB();

// Initialize Telegram Bot
initBot();

// Start server
app.listen(PORT, () => {
  console.log(`[SERVER] BigBasket Mini App running on port ${PORT}`);
  console.log(`[SERVER] Mini App URL: http://localhost:${PORT}/miniapp`);
  console.log(`[SERVER] API URL: http://localhost:${PORT}/api`);
});

module.exports = app;
