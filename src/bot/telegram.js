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

  // ==================== /start command ====================
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const firstName = msg.from.first_name || 'User';

    userOps.createUser(telegramId);
    const user = userOps.getUser(telegramId);

    if (user && user.state === USER_STATES.AUTHENTICATED && user.bb_access_token) {
      await sendMainMenu(chatId, firstName);
    } else {
      await sendWelcome(chatId, firstName);
    }
  });

  // ==================== CALLBACK QUERIES (Button clicks) ====================
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;
    const firstName = query.from.first_name || 'User';

    await bot.answerCallbackQuery(query.id);

    switch (data) {
      case 'login':
        userOps.createUser(telegramId);
        userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
        await bot.sendMessage(chatId,
          '📱 *Enter your 10-digit phone number*\n\n' +
          'This should be the number linked to your BigBasket account:',
          { parse_mode: 'Markdown' }
        );
        break;

      case 'login_another':
        userOps.clearUserSession(telegramId);
        userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
        await bot.sendMessage(chatId,
          '📱 *Enter a new phone number*\n\n' +
          'Enter 10-digit number linked to BigBasket:',
          { parse_mode: 'Markdown' }
        );
        break;

      case 'open_shop':
        await sendMiniAppButton(chatId, firstName);
        break;

      case 'my_profile':
        await showProfile(chatId, telegramId);
        break;

      case 'logout':
        userOps.clearUserSession(telegramId);
        await bot.sendMessage(chatId,
          '✅ You have been logged out.\n\nTap below to login again:',
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '🔑 Login with Phone', callback_data: 'login' }
              ]]
            }
          }
        );
        break;

      case 'help':
        await sendHelp(chatId);
        break;

      case 'resend_otp':
        const user = userOps.getUser(telegramId);
        if (user && user.phone_number) {
          await sendOTPToPhone(chatId, telegramId, user.phone_number);
        } else {
          await bot.sendMessage(chatId, '⚠️ No phone number found. Please login again.');
        }
        break;
    }
  });

  // ==================== Handle text messages (phone & OTP) ====================
  bot.on('message', async (msg) => {
    if (msg.contact) return;
    if (msg.text && msg.text.startsWith('/')) return;
    if (!msg.text) return;

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text.trim();
    const firstName = msg.from.first_name || 'User';

    const user = userOps.getUser(telegramId);
    if (!user) {
      userOps.createUser(telegramId);
      return sendWelcome(chatId, firstName);
    }

    switch (user.state) {
      case USER_STATES.AWAITING_PHONE:
        await handlePhoneNumber(chatId, telegramId, text);
        break;

      case USER_STATES.AWAITING_OTP:
        await handleOTP(chatId, telegramId, text, firstName);
        break;

      case USER_STATES.AUTHENTICATED:
        await sendMainMenu(chatId, firstName);
        break;

      default:
        await sendWelcome(chatId, firstName);
    }
  });

  // ==================== Handle contact sharing ====================
  bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const phoneNumber = msg.contact.phone_number.replace(/^\+91/, '').replace(/^\+/, '');
    await handlePhoneNumber(chatId, telegramId, phoneNumber);
  });

  return bot;
}

// ==================== WELCOME SCREEN ====================
async function sendWelcome(chatId, firstName) {
  await bot.sendMessage(chatId,
    `🛒 *Welcome to BigBasket, ${firstName}!*\n\n` +
    `Shop fresh groceries right here in Telegram.\n\n` +
    `Tap the button below to get started:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔑 Login with Phone Number', callback_data: 'login' }],
          [{ text: '❓ Help', callback_data: 'help' }],
        ]
      }
    }
  );
}

// ==================== MAIN MENU (after login) ====================
async function sendMainMenu(chatId, firstName) {
  const miniAppUrl = process.env.MINI_APP_URL || `http://localhost:${process.env.PORT || 3000}/miniapp`;

  await bot.sendMessage(chatId,
    `✅ *Welcome back, ${firstName}!*\n\n` +
    `You're logged in to BigBasket. What would you like to do?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛍️ Open BigBasket Shop', web_app: { url: miniAppUrl } }],
          [{ text: '🔄 Login Another Number', callback_data: 'login_another' }],
          [{ text: '👤 My Profile', callback_data: 'my_profile' }],
          [{ text: '🚪 Logout', callback_data: 'logout' }],
        ]
      }
    }
  );
}

// ==================== HANDLE PHONE NUMBER ====================
async function handlePhoneNumber(chatId, telegramId, phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');

  if (cleanPhone.length !== 10) {
    return bot.sendMessage(chatId,
      '❌ Invalid phone number.\n\nPlease enter a valid 10-digit Indian mobile number:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Start', callback_data: 'login' }]
          ]
        }
      }
    );
  }

  userOps.updateUserPhone(telegramId, cleanPhone);
  await sendOTPToPhone(chatId, telegramId, cleanPhone);
}

// ==================== SEND OTP ====================
async function sendOTPToPhone(chatId, telegramId, phoneNumber) {
  await bot.sendMessage(chatId, `📲 Sending OTP to +91${phoneNumber}...`);

  const bbApi = new BigBasketAPI();
  const result = await bbApi.sendOTP(phoneNumber);

  if (result.success) {
    userOps.updateUserState(telegramId, USER_STATES.AWAITING_OTP);
    await bot.sendMessage(chatId,
      `✅ *OTP sent to +91${phoneNumber}*\n\n` +
      `Please enter the 6-digit OTP you received:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Resend OTP', callback_data: 'resend_otp' }],
            [{ text: '📱 Change Number', callback_data: 'login' }],
          ]
        }
      }
    );
  } else {
    console.error('[BOT] OTP send failed:', JSON.stringify(result));
    await bot.sendMessage(chatId,
      `❌ *Failed to send OTP*\n\n` +
      `Reason: ${result.error}\n\n` +
      `Please try again:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: 'login' }],
            [{ text: '📱 Different Number', callback_data: 'login_another' }],
          ]
        }
      }
    );
  }
}

// ==================== HANDLE OTP VERIFICATION ====================
async function handleOTP(chatId, telegramId, otp, firstName) {
  const cleanOTP = otp.replace(/[^0-9]/g, '');

  if (cleanOTP.length < 4 || cleanOTP.length > 6) {
    return bot.sendMessage(chatId,
      '❌ Invalid OTP. Please enter the 4-6 digit code:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Resend OTP', callback_data: 'resend_otp' }],
            [{ text: '📱 Change Number', callback_data: 'login' }],
          ]
        }
      }
    );
  }

  const user = userOps.getUser(telegramId);
  if (!user || !user.phone_number) {
    userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
    return bot.sendMessage(chatId, '⚠️ Session expired. Please enter your phone number again.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Login Again', callback_data: 'login' }]
          ]
        }
      }
    );
  }

  await bot.sendMessage(chatId, '🔐 Verifying OTP...');

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

    const name = result.data.userName || firstName;
    await bot.sendMessage(chatId,
      `🎉 *Login Successful!*\n\n` +
      `Welcome, ${name}! You're now connected to BigBasket.\n\n` +
      `Tap below to start shopping:`,
      { parse_mode: 'Markdown' }
    );
    await sendMainMenu(chatId, name);
  } else {
    await bot.sendMessage(chatId,
      `❌ *OTP Verification Failed*\n\n` +
      `${result.error}\n\n` +
      `Please try again:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Resend OTP', callback_data: 'resend_otp' }],
            [{ text: '📱 Change Number', callback_data: 'login' }],
            [{ text: '🔙 Back to Start', callback_data: 'login' }],
          ]
        }
      }
    );
  }
}

// ==================== SHOW PROFILE ====================
async function showProfile(chatId, telegramId) {
  const user = userOps.getUser(telegramId);
  if (!user || !user.bb_access_token) {
    return bot.sendMessage(chatId, '⚠️ Not logged in.',
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🔑 Login', callback_data: 'login' }]]
        }
      }
    );
  }

  const bbApi = new BigBasketAPI(user.bb_access_token);
  const tokenInfo = bbApi.getTokenInfo();

  let msg = `👤 *Your Profile*\n\n`;
  msg += `📱 Phone: +91${user.phone_number || 'Unknown'}\n`;
  msg += `🆔 Member ID: ${user.bb_member_id || tokenInfo?.memberId || 'Unknown'}\n`;
  if (tokenInfo) {
    msg += `📅 Token Expires: ${tokenInfo.expiresAt || 'Unknown'}\n`;
    msg += `⏰ Expired: ${tokenInfo.isExpired ? '⚠️ YES' : '✅ No'}\n`;
  }

  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛍️ Open Shop', callback_data: 'open_shop' }],
        [{ text: '🔄 Login Another Number', callback_data: 'login_another' }],
        [{ text: '🚪 Logout', callback_data: 'logout' }],
      ]
    }
  });
}

// ==================== HELP ====================
async function sendHelp(chatId) {
  await bot.sendMessage(chatId,
    `🛒 *BigBasket Mini App - Help*\n\n` +
    `*How it works:*\n` +
    `1️⃣ Login with your phone number\n` +
    `2️⃣ Enter the OTP sent to your phone\n` +
    `3️⃣ Open the Mini App to browse & shop\n\n` +
    `*Features:*\n` +
    `• Browse all BigBasket products\n` +
    `• Search for items\n` +
    `• Add to cart & checkout\n` +
    `• View order history\n` +
    `• Multiple accounts supported\n\n` +
    `Each phone number has its own separate profile, cart, and orders.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔑 Login Now', callback_data: 'login' }],
        ]
      }
    }
  );
}

// ==================== MINI APP BUTTON ====================
async function sendMiniAppButton(chatId, name) {
  const miniAppUrl = process.env.MINI_APP_URL || `http://localhost:${process.env.PORT || 3000}/miniapp`;

  await bot.sendMessage(chatId,
    `🛒 *Open BigBasket*\n\nHey ${name}, tap below to browse groceries!`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🛍️ Open BigBasket Shop', web_app: { url: miniAppUrl } }
        ]]
      }
    }
  );
}

function getBot() {
  return bot;
}

module.exports = { initBot, getBot };
