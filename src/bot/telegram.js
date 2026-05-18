const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const { USER_STATES } = require('../config/constants');
const { userOps, sessionOps } = require('../db/database');
const BigBasketAPI = require('../services/bigbasket-api');

let bot;

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token || token === 'your_telegram_bot_token_here') {
    console.log('[BOT] No valid Telegram bot token found. Bot disabled.');
    console.log('[BOT] Set TELEGRAM_BOT_TOKEN in .env to enable the bot.');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });

  console.log('[BOT] Telegram bot started successfully');

  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const firstName = msg.from.first_name || 'User';

    // Create user if doesn't exist
    userOps.createUser(telegramId);

    const user = userOps.getUser(telegramId);

    if (user && user.state === USER_STATES.AUTHENTICATED && user.bb_access_token) {
      // User already authenticated - show Mini App button
      await sendMiniAppButton(chatId, firstName);
    } else {
      // Start login flow
      await bot.sendMessage(chatId, 
        `Welcome to BigBasket, ${firstName}! 🛒\n\n` +
        `I'll help you shop groceries right here in Telegram.\n\n` +
        `To get started, I need to verify your BigBasket account.\n\n` +
        `Please share your 10-digit phone number (linked to BigBasket):`,
        {
          reply_markup: {
            keyboard: [[{ text: '📱 Share Phone Number', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
    }
  });

  // Handle contact sharing (phone number)
  bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const phoneNumber = msg.contact.phone_number.replace(/^\+91/, '').replace(/^\+/, '');

    await handlePhoneNumber(chatId, telegramId, phoneNumber);
  });

  // Handle text messages (phone number or OTP)
  bot.on('message', async (msg) => {
    if (msg.contact) return; // Already handled
    if (msg.text && msg.text.startsWith('/')) return; // Commands handled separately

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text?.trim();

    if (!text) return;

    const user = userOps.getUser(telegramId);
    if (!user) {
      userOps.createUser(telegramId);
      return bot.sendMessage(chatId, 'Please use /start to begin.');
    }

    switch (user.state) {
      case USER_STATES.AWAITING_PHONE:
        await handlePhoneNumber(chatId, telegramId, text);
        break;
      
      case USER_STATES.AWAITING_OTP:
        await handleOTP(chatId, telegramId, text);
        break;

      case USER_STATES.AUTHENTICATED:
        await bot.sendMessage(chatId, 
          `You're already logged in! 🎉\nUse the button below to open BigBasket:`,
        );
        await sendMiniAppButton(chatId, msg.from.first_name);
        break;

      default:
        await bot.sendMessage(chatId, 'Please use /start to begin.');
    }
  });

  // /login command - restart login flow
  bot.onText(/\/login/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    userOps.createUser(telegramId);
    userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);

    await bot.sendMessage(chatId,
      `📱 Please enter your 10-digit phone number linked to BigBasket:`,
      {
        reply_markup: {
          keyboard: [[{ text: '📱 Share Phone Number', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  });

  // /logout command
  bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    userOps.clearUserSession(telegramId);
    await bot.sendMessage(chatId, '✅ You have been logged out. Use /start to log in again.');
  });

  // /shop command - quick access to Mini App
  bot.onText(/\/shop/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = userOps.getUser(telegramId);

    if (user && user.state === USER_STATES.AUTHENTICATED) {
      await sendMiniAppButton(chatId, msg.from.first_name);
    } else {
      await bot.sendMessage(chatId, '⚠️ Please log in first using /start');
    }
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
      `🛒 *BigBasket Mini App - Help*\n\n` +
      `*Commands:*\n` +
      `/start - Start or restart the bot\n` +
      `/login - Log in with your phone number\n` +
      `/shop - Open the Mini App\n` +
      `/logout - Log out from your account\n` +
      `/help - Show this help message\n\n` +
      `*How it works:*\n` +
      `1. Share your phone number\n` +
      `2. Enter the OTP sent to your phone\n` +
      `3. Open the Mini App to browse & shop!\n\n` +
      `All your BigBasket data (cart, orders, addresses) is synced.`,
      { parse_mode: 'Markdown' }
    );
  });

  return bot;
}

/**
 * Handle phone number input
 */
async function handlePhoneNumber(chatId, telegramId, phoneNumber) {
  // Clean phone number
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  
  // Validate - must be 10 digits (Indian number)
  if (cleanPhone.length !== 10) {
    return bot.sendMessage(chatId, 
      '❌ Invalid phone number. Please enter a valid 10-digit Indian mobile number.'
    );
  }

  // Store phone & update state
  userOps.updateUserPhone(telegramId, cleanPhone);

  await bot.sendMessage(chatId, `📲 Sending OTP to +91${cleanPhone}...`);

  // Call BigBasket API to send OTP
  const bbApi = new BigBasketAPI();
  const result = await bbApi.sendOTP(cleanPhone);

  if (result.success) {
    userOps.updateUserState(telegramId, USER_STATES.AWAITING_OTP);
    await bot.sendMessage(chatId,
      `✅ OTP sent successfully!\n\n` +
      `Please enter the 6-digit OTP you received on +91${cleanPhone}:`,
      {
        reply_markup: { remove_keyboard: true },
      }
    );
  } else {
    await bot.sendMessage(chatId,
      `❌ Failed to send OTP: ${result.error}\n\n` +
      `Please try again or enter a different number.`
    );
  }
}

/**
 * Handle OTP verification
 */
async function handleOTP(chatId, telegramId, otp) {
  // Validate OTP format
  const cleanOTP = otp.replace(/[^0-9]/g, '');
  
  if (cleanOTP.length < 4 || cleanOTP.length > 6) {
    return bot.sendMessage(chatId, '❌ Invalid OTP. Please enter the 4-6 digit code.');
  }

  const user = userOps.getUser(telegramId);
  if (!user || !user.phone_number) {
    userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
    return bot.sendMessage(chatId, '⚠️ Session expired. Please enter your phone number again.');
  }

  await bot.sendMessage(chatId, '🔐 Verifying OTP...');

  // Call BigBasket API to verify OTP
  const bbApi = new BigBasketAPI();
  const result = await bbApi.verifyOTP(user.phone_number, cleanOTP);

  if (result.success) {
    // Store tokens
    userOps.updateUserTokens(telegramId, {
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      memberId: result.data.memberId,
      visitorId: result.data.visitorId,
    });

    // Create session for Mini App
    const sessionId = uuidv4();
    sessionOps.createSession(sessionId, telegramId);

    const name = result.data.userName || 'there';
    await bot.sendMessage(chatId,
      `🎉 Welcome, ${name}! You're now logged in.\n\n` +
      `Tap the button below to start shopping:`,
    );
    await sendMiniAppButton(chatId, name);
  } else {
    await bot.sendMessage(chatId,
      `❌ ${result.error}\n\nPlease try again or type /login to restart.`
    );
  }
}

/**
 * Send Mini App web app button
 */
async function sendMiniAppButton(chatId, name) {
  const miniAppUrl = process.env.MINI_APP_URL || `http://localhost:${process.env.PORT || 3000}/miniapp`;
  
  await bot.sendMessage(chatId,
    `🛒 *Open BigBasket*\nHey ${name}, tap below to browse groceries!`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🛍️ Open BigBasket Shop',
            web_app: { url: miniAppUrl },
          }
        ]],
      },
    }
  );
}

function getBot() {
  return bot;
}

module.exports = { initBot, getBot };
