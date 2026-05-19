#!/usr/bin/env node
/**
 * Setup script for BigBasket Telegram Mini App
 * 
 * This script helps configure the Telegram bot with BotFather:
 * 1. Sets the menu button to open the Mini App
 * 2. Configures bot commands
 * 
 * Usage: node scripts/setup-bot.js <your-ngrok-url>
 * Example: node scripts/setup-bot.js https://abc123.ngrok-free.app
 */
require('dotenv').config();
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NGROK_URL = process.argv[2] || process.env.MINI_APP_URL;

if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') {
  console.error('❌ Set TELEGRAM_BOT_TOKEN in .env first');
  process.exit(1);
}

if (!NGROK_URL || NGROK_URL.includes('your-ngrok-url')) {
  console.error('❌ Provide your ngrok URL as argument or set MINI_APP_URL in .env');
  console.error('   Usage: node scripts/setup-bot.js https://your-url.ngrok-free.app');
  process.exit(1);
}

const MINI_APP_URL = NGROK_URL.endsWith('/miniapp') ? NGROK_URL : `${NGROK_URL}/miniapp`;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function setup() {
  console.log('🤖 Setting up Telegram Bot...\n');
  console.log(`   Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
  console.log(`   Mini App URL: ${MINI_APP_URL}\n`);

  try {
    // 1. Get bot info
    const me = await axios.get(`${API_BASE}/getMe`);
    console.log(`✅ Bot: @${me.data.result.username} (${me.data.result.first_name})`);

    // 2. Set bot commands
    await axios.post(`${API_BASE}/setMyCommands`, {
      commands: [
        { command: 'start', description: 'Start the bot & login' },
        { command: 'shop', description: 'Open BigBasket Mini App' },
        { command: 'help', description: 'How to use this bot' },
      ],
    });
    console.log('✅ Bot commands set');

    // 3. Set menu button to open Mini App
    await axios.post(`${API_BASE}/setChatMenuButton`, {
      menu_button: {
        type: 'web_app',
        text: '🛒 BigBasket',
        web_app: { url: MINI_APP_URL },
      },
    });
    console.log('✅ Menu button set to open Mini App');

    // 4. Set bot description
    await axios.post(`${API_BASE}/setMyDescription`, {
      description: 'Shop fresh groceries from BigBasket right inside Telegram! Login with your phone number to get started.',
    });
    console.log('✅ Bot description set');

    // 5. Set short description
    await axios.post(`${API_BASE}/setMyShortDescription`, {
      short_description: 'BigBasket grocery shopping in Telegram',
    });
    console.log('✅ Bot short description set');

    console.log('\n🎉 Setup complete! Your bot is ready.');
    console.log(`\n📱 Open your bot in Telegram and tap the menu button to launch the Mini App.`);
    console.log(`   Or send /start to begin the login flow.\n`);

  } catch (error) {
    console.error('❌ Setup failed:', error.response?.data?.description || error.message);
    process.exit(1);
  }
}

setup();
