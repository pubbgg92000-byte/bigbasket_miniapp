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

      case 'awaiting_creds':
        await handleManualCreds(chatId, telegramId, text);
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

  // /settoken command - manually inject BigBasket token (from mitmproxy capture)
  bot.onText(/\/settoken (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const token = match[1].trim();

    if (!token || token.length < 10) {
      return bot.sendMessage(chatId, 
        '❌ Invalid token. Usage:\n`/settoken YOUR_BB_ACCESS_TOKEN`\n\n' +
        'Get your token by intercepting BigBasket app traffic with mitmproxy.',
        { parse_mode: 'Markdown' }
      );
    }

    userOps.createUser(telegramId);
    userOps.updateUserTokens(telegramId, {
      accessToken: token,
      refreshToken: null,
      memberId: null,
      visitorId: null,
    });

    const sessionId = uuidv4();
    sessionOps.createSession(sessionId, telegramId);

    await bot.sendMessage(chatId,
      `✅ Token set successfully! You're now authenticated.\n\n` +
      `Tap below to start shopping:`,
    );
    await sendMiniAppButton(chatId, msg.from.first_name || 'User');
  });

  // /setcreds command - set full credentials (token + visitor_id + member_id)
  bot.onText(/\/setcreds/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    userOps.createUser(telegramId);
    userOps.updateUserState(telegramId, 'awaiting_creds');

    await bot.sendMessage(chatId,
      `🔧 *Manual Credential Setup*\n\n` +
      `Send your BigBasket credentials in this format:\n\n` +
      '```\ntoken: YOUR_ACCESS_TOKEN\nvisitor_id: YOUR_VISITOR_ID\nmember_id: YOUR_MEMBER_ID\n```\n\n' +
      `*How to get these:*\n` +
      `1. Install mitmproxy on your PC\n` +
      `2. Connect your phone through the proxy\n` +
      `3. Open BigBasket app & log in\n` +
      `4. Copy the X-BB-Token, X-Visitor-Id from request headers\n` +
      `5. Or look for access_token in the login response`,
      { parse_mode: 'Markdown' }
    );
  });

  // /capture command - show how to capture API traffic
  bot.onText(/\/capture/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
      `🔬 *How to Capture BigBasket API Traffic*\n\n` +
      `*Method 1 - mitmproxy (Recommended):*\n` +
      `1. Install mitmproxy: \`pip install mitmproxy\`\n` +
      `2. Run: \`mitmweb --listen-port 8080\`\n` +
      `3. Set phone proxy to your PC IP:8080\n` +
      `4. Install mitmproxy CA cert on phone\n` +
      `5. Open BigBasket app → Login\n` +
      `6. Check mitmweb for requests to bigbasket.com\n\n` +
      `*Method 2 - Frida (for SSL pinning bypass):*\n` +
      `1. Root your device / use emulator\n` +
      `2. Install Frida server on device\n` +
      `3. Run: \`frida -U -f com.bigbasket.mobileapp -l ssl_bypass.js\`\n` +
      `4. Capture traffic through mitmproxy\n\n` +
      `*What to look for:*\n` +
      `• POST request when you enter phone number (OTP endpoint)\n` +
      `• POST request when you enter OTP (verify endpoint)\n` +
      `• Headers: X-BB-Token, X-Visitor-Id, User-Agent\n` +
      `• Response: access_token, member_id\n\n` +
      `Once captured, use /settoken or /setcreds to authenticate.`,
      { parse_mode: 'Markdown' }
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
    console.error('[BOT] OTP send failed:', JSON.stringify(result));
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
 * Handle manual credentials input (from mitmproxy capture)
 */
async function handleManualCreds(chatId, telegramId, text) {
  // Parse credentials from text (supports multiple formats)
  const lines = text.split('\n');
  let accessToken = null;
  let visitorId = null;
  let memberId = null;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    if (lower.startsWith('token:') || lower.startsWith('access_token:') || lower.startsWith('x-bb-token:')) {
      accessToken = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('visitor_id:') || lower.startsWith('x-visitor-id:') || lower.startsWith('visitor:')) {
      visitorId = line.split(':').slice(1).join(':').trim();
    } else if (lower.startsWith('member_id:') || lower.startsWith('member:') || lower.startsWith('user_id:')) {
      memberId = line.split(':').slice(1).join(':').trim();
    }
  }

  // If just a single line, treat as token
  if (!accessToken && lines.length === 1 && text.trim().length > 10) {
    accessToken = text.trim();
  }

  if (!accessToken) {
    return bot.sendMessage(chatId,
      '❌ Could not parse credentials. Please send in this format:\n\n' +
      '```\ntoken: YOUR_ACCESS_TOKEN\nvisitor_id: YOUR_VISITOR_ID\nmember_id: YOUR_MEMBER_ID\n```\n\n' +
      'Or just send the token alone.',
      { parse_mode: 'Markdown' }
    );
  }

  userOps.updateUserTokens(telegramId, {
    accessToken,
    refreshToken: null,
    memberId: memberId || null,
    visitorId: visitorId || null,
  });

  const sessionId = uuidv4();
  sessionOps.createSession(sessionId, telegramId);

  await bot.sendMessage(chatId,
    `✅ Credentials set successfully!\n\n` +
    `• Token: ${accessToken.substring(0, 20)}....\n` +
    `• Visitor ID: ${visitorId || 'auto-generated'}\n` +
    `• Member ID: ${memberId || 'unknown'}\n\n` +
    `You're now authenticated. Tap below to shop:`,
  );
  await sendMiniAppButton(chatId, 'there');
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
