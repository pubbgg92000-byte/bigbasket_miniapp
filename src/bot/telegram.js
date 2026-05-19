const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const { USER_STATES } = require('../config/constants');
const { userOps, accountOps, sessionOps } = require('../db/database');
const BigBasketAPI = require('../services/bigbasket-api');

let bot;

/**
 * Match reply keyboard button text to an action
 */
function matchReplyButton(text) {
  const map = {
    '🛍️ Shop': 'shop',
    '➕ Add Account': 'add_account',
    '👥 My Accounts': 'my_accounts',
    '👤 Profile': 'profile',
    '📦 Orders': 'orders',
    '❓ Help': 'help',
    '🚪 Logout': 'logout',
  };
  return map[text] || null;
}

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token === 'your_telegram_bot_token_here') {
    console.log('[BOT] No valid Telegram bot token found. Bot disabled.');
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
    const accounts = accountOps.getAccounts(telegramId);

    if (accounts.length > 0) {
      await sendMainMenu(chatId, firstName, telegramId);
    } else {
      await sendWelcome(chatId, firstName);
    }
  });

  // ==================== /shop command ====================
  bot.onText(/\/shop/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'User';
    const telegramId = msg.from.id;
    const active = accountOps.getActiveAccount(telegramId);

    if (active && active.bb_access_token) {
      await sendMiniAppButton(chatId, firstName);
    } else {
      await bot.sendMessage(chatId, '⚠️ No active account. Please login or switch account.', {
        reply_markup: { inline_keyboard: [
          [{ text: '➕ Add Account', callback_data: 'add_account' }],
          [{ text: '👥 My Accounts', callback_data: 'my_accounts' }],
        ]}
      });
    }
  });

  // ==================== CALLBACK QUERIES ====================
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;
    const firstName = query.from.first_name || 'User';

    await bot.answerCallbackQuery(query.id);

    // Handle switch_account_<id> callbacks
    if (data.startsWith('switch_')) {
      const accountId = parseInt(data.replace('switch_', ''));
      const account = accountOps.switchAccount(telegramId, accountId);
      if (account) {
        await bot.sendMessage(chatId,
          `✅ Switched to account: *+91${account.phone_number}*${account.name ? ` (${account.name})` : ''}`,
          { parse_mode: 'Markdown' }
        );
        await sendMainMenu(chatId, firstName, telegramId);
      }
      return;
    }

    // Handle remove_account_<id> callbacks
    if (data.startsWith('remove_')) {
      const accountId = parseInt(data.replace('remove_', ''));
      const account = accountOps.getAccountById(accountId);
      accountOps.removeAccount(telegramId, accountId);
      await bot.sendMessage(chatId, `🗑️ Removed account: +91${account?.phone_number || 'unknown'}`);
      await showAccounts(chatId, telegramId);
      return;
    }

    switch (data) {
      case 'add_account':
      case 'login':
        userOps.createUser(telegramId);
        userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
        await bot.sendMessage(chatId,
          '📱 *Enter your 10-digit phone number*\n\n' +
          'This should be the number linked to your BigBasket account:',
          { parse_mode: 'Markdown' }
        );
        break;

      case 'my_accounts':
        await showAccounts(chatId, telegramId);
        break;

      case 'open_shop':
        await sendMiniAppButton(chatId, firstName);
        break;

      case 'my_profile':
        await showProfile(chatId, telegramId);
        break;

      case 'logout':
        const active = accountOps.getActiveAccount(telegramId);
        if (active) {
          accountOps.removeAccount(telegramId, active.id);
          await bot.sendMessage(chatId, `✅ Logged out from +91${active.phone_number}`);
          const remaining = accountOps.getAccounts(telegramId);
          if (remaining.length > 0) {
            await showAccounts(chatId, telegramId);
          } else {
            await sendWelcome(chatId, firstName);
          }
        } else {
          await sendWelcome(chatId, firstName);
        }
        break;

      case 'help':
        await sendHelp(chatId);
        break;

      case 'my_orders':
        const activeAcc = accountOps.getActiveAccount(telegramId);
        if (activeAcc?.bb_access_token) {
          await bot.sendMessage(chatId, `📦 Orders for +91${activeAcc.phone_number}.\nOpen the Mini App to view:`, {
            reply_markup: { inline_keyboard: [[{ text: '🛍️ Open Shop', callback_data: 'open_shop' }]] }
          });
        } else {
          await bot.sendMessage(chatId, '⚠️ No active account.', {
            reply_markup: { inline_keyboard: [[{ text: '➕ Add Account', callback_data: 'add_account' }]] }
          });
        }
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

  // ==================== Handle text messages ====================
  bot.on('message', async (msg) => {
    if (msg.contact) return;
    if (msg.text && msg.text.startsWith('/')) return;
    if (!msg.text) return;

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text.trim();
    const firstName = msg.from.first_name || 'User';

    // Handle reply keyboard buttons
    const buttonAction = matchReplyButton(text);
    if (buttonAction) {
      switch (buttonAction) {
        case 'shop':
          const active = accountOps.getActiveAccount(telegramId);
          if (active?.bb_access_token) return sendMiniAppButton(chatId, firstName);
          return bot.sendMessage(chatId, '⚠️ No active account.', {
            reply_markup: { inline_keyboard: [[{ text: '➕ Add Account', callback_data: 'add_account' }], [{ text: '👥 My Accounts', callback_data: 'my_accounts' }]] }
          });
        case 'add_account':
          userOps.createUser(telegramId);
          userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
          return bot.sendMessage(chatId, '📱 *Enter your 10-digit phone number:*', { parse_mode: 'Markdown' });
        case 'my_accounts':
          return showAccounts(chatId, telegramId);
        case 'profile':
          return showProfile(chatId, telegramId);
        case 'orders':
          const acc = accountOps.getActiveAccount(telegramId);
          if (acc?.bb_access_token) {
            return bot.sendMessage(chatId, '📦 Open the Mini App to view orders.', {
              reply_markup: { inline_keyboard: [[{ text: '🛍️ Open Shop', callback_data: 'open_shop' }]] }
            });
          }
          return bot.sendMessage(chatId, '⚠️ No active account.', {
            reply_markup: { inline_keyboard: [[{ text: '➕ Add Account', callback_data: 'add_account' }]] }
          });
        case 'help':
          return sendHelp(chatId);
        case 'logout':
          const activeAcc = accountOps.getActiveAccount(telegramId);
          if (activeAcc) {
            accountOps.removeAccount(telegramId, activeAcc.id);
            await bot.sendMessage(chatId, `✅ Logged out from +91${activeAcc.phone_number}`);
          }
          const remaining = accountOps.getAccounts(telegramId);
          if (remaining.length > 0) return showAccounts(chatId, telegramId);
          return sendWelcome(chatId, firstName);
      }
      return;
    }

    // State-based handling (phone/OTP input)
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
      default:
        const accounts = accountOps.getAccounts(telegramId);
        if (accounts.length > 0) {
          await sendMainMenu(chatId, firstName, telegramId);
        } else {
          await sendWelcome(chatId, firstName);
        }
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
    `Shop fresh groceries right here in Telegram.\n` +
    `You can add multiple BigBasket accounts and switch between them anytime.\n\n` +
    `Tap below to get started:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add BigBasket Account', callback_data: 'add_account' }],
          [{ text: '❓ Help', callback_data: 'help' }],
        ]
      }
    }
  );
  await sendReplyKeyboard(chatId);
}

// ==================== MAIN MENU ====================
async function sendMainMenu(chatId, firstName, telegramId) {
  const miniAppUrl = process.env.MINI_APP_URL || `http://localhost:${process.env.PORT || 3000}/miniapp`;
  const active = accountOps.getActiveAccount(telegramId);
  const accounts = accountOps.getAccounts(telegramId);

  let statusLine = '';
  if (active) {
    statusLine = `📱 Active: +91${active.phone_number}${active.name ? ` (${active.name})` : ''}\n`;
    statusLine += `👥 Total accounts: ${accounts.length}\n`;
  }

  await bot.sendMessage(chatId,
    `✅ *Welcome back, ${firstName}!*\n\n` +
    `${statusLine}\n` +
    `What would you like to do?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛍️ Open BigBasket Shop', web_app: { url: miniAppUrl } }],
          [{ text: '👥 My Accounts', callback_data: 'my_accounts' }, { text: '➕ Add Account', callback_data: 'add_account' }],
          [{ text: '👤 Profile', callback_data: 'my_profile' }, { text: '📦 Orders', callback_data: 'my_orders' }],
          [{ text: '❓ Help', callback_data: 'help' }, { text: '🚪 Logout', callback_data: 'logout' }],
        ]
      }
    }
  );
  await sendReplyKeyboard(chatId);
}

// ==================== PERSISTENT REPLY KEYBOARD ====================
async function sendReplyKeyboard(chatId) {
  await bot.sendMessage(chatId, '⌨️', {
    reply_markup: {
      keyboard: [
        [{ text: '🛍️ Shop' }, { text: '👥 My Accounts' }],
        [{ text: '➕ Add Account' }, { text: '👤 Profile' }],
        [{ text: '📦 Orders' }, { text: '❓ Help' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    }
  });
}

// ==================== SHOW ACCOUNTS ====================
async function showAccounts(chatId, telegramId) {
  const accounts = accountOps.getAccounts(telegramId);

  if (accounts.length === 0) {
    return bot.sendMessage(chatId,
      '📱 *No accounts added yet*\n\nAdd your first BigBasket account:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '➕ Add Account', callback_data: 'add_account' }]]
        }
      }
    );
  }

  let msg = `👥 *Your BigBasket Accounts* (${accounts.length})\n\n`;
  const buttons = [];

  accounts.forEach((acc, i) => {
    const activeIcon = acc.is_active ? '✅' : '⚪';
    const name = acc.name ? ` - ${acc.name}` : '';
    msg += `${activeIcon} ${i + 1}. +91${acc.phone_number}${name}\n`;

    if (!acc.is_active) {
      buttons.push([
        { text: `🔄 Switch to +91${acc.phone_number}`, callback_data: `switch_${acc.id}` },
        { text: `🗑️`, callback_data: `remove_${acc.id}` },
      ]);
    } else {
      buttons.push([
        { text: `✅ Active: +91${acc.phone_number}`, callback_data: 'noop' },
        { text: `🗑️`, callback_data: `remove_${acc.id}` },
      ]);
    }
  });

  buttons.push([{ text: '➕ Add New Account', callback_data: 'add_account' }]);

  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// ==================== HANDLE PHONE NUMBER ====================
async function handlePhoneNumber(chatId, telegramId, phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');

  if (cleanPhone.length !== 10) {
    return bot.sendMessage(chatId,
      '❌ Invalid phone number.\n\nPlease enter a valid 10-digit Indian mobile number:',
      { reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'my_accounts' }]] } }
    );
  }

  // Check if already logged in with this number
  const existing = accountOps.getAccountByPhone(telegramId, cleanPhone);
  if (existing && existing.bb_access_token) {
    accountOps.switchAccount(telegramId, existing.id);
    userOps.updateUserState(telegramId, USER_STATES.AUTHENTICATED);
    await bot.sendMessage(chatId,
      `✅ Already logged in with +91${cleanPhone}. Switched to this account.`,
    );
    return sendMainMenu(chatId, '', telegramId);
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
    const channelMsg = result.data?.channel === 'voice' 
      ? '📞 You will receive a *voice call* with the OTP.'
      : '📱 Check your SMS for the OTP.';
    await bot.sendMessage(chatId,
      `✅ *OTP sent to +91${phoneNumber}*\n\n${channelMsg}\nPlease enter the OTP you received:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Resend OTP', callback_data: 'resend_otp' }],
            [{ text: '📱 Change Number', callback_data: 'add_account' }],
            [{ text: '🔙 Cancel', callback_data: 'my_accounts' }],
          ]
        }
      }
    );
  } else {
    console.error('[BOT] OTP send failed:', JSON.stringify(result));
    await bot.sendMessage(chatId,
      `❌ *Failed to send OTP*\n\nReason: ${result.error}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: 'add_account' }],
            [{ text: '👥 My Accounts', callback_data: 'my_accounts' }],
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
            [{ text: '📱 Change Number', callback_data: 'add_account' }],
          ]
        }
      }
    );
  }

  const user = userOps.getUser(telegramId);
  if (!user || !user.phone_number) {
    userOps.updateUserState(telegramId, USER_STATES.AWAITING_PHONE);
    return bot.sendMessage(chatId, '⚠️ Session expired. Please try again.', {
      reply_markup: { inline_keyboard: [[{ text: '➕ Add Account', callback_data: 'add_account' }]] }
    });
  }

  await bot.sendMessage(chatId, '🔐 Verifying OTP...');

  const bbApi = new BigBasketAPI();
  const result = await bbApi.verifyOTP(user.phone_number, cleanOTP);

  if (result.success) {
    // Store account (multi-account)
    accountOps.upsertAccount(telegramId, {
      phone: user.phone_number,
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      memberId: result.data.memberId,
      visitorId: result.data.visitorId,
      name: result.data.userName || null,
    });

    userOps.updateUserState(telegramId, USER_STATES.AUTHENTICATED);

    // Create session for Mini App
    const sessionId = uuidv4();
    sessionOps.createSession(sessionId, telegramId);

    const name = result.data.userName || firstName;
    const totalAccounts = accountOps.getAccounts(telegramId).length;

    await bot.sendMessage(chatId,
      `🎉 *Login Successful!*\n\n` +
      `Account +91${user.phone_number} added.${totalAccounts > 1 ? `\nYou now have ${totalAccounts} accounts.` : ''}\n\n` +
      `Tap below to start shopping:`,
      { parse_mode: 'Markdown' }
    );
    await sendMainMenu(chatId, name, telegramId);
  } else {
    await bot.sendMessage(chatId,
      `❌ *OTP Verification Failed*\n\n${result.error}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Resend OTP', callback_data: 'resend_otp' }],
            [{ text: '📱 Change Number', callback_data: 'add_account' }],
          ]
        }
      }
    );
  }
}

// ==================== SHOW PROFILE ====================
async function showProfile(chatId, telegramId) {
  const active = accountOps.getActiveAccount(telegramId);
  if (!active || !active.bb_access_token) {
    return bot.sendMessage(chatId, '⚠️ No active account.', {
      reply_markup: { inline_keyboard: [[{ text: '➕ Add Account', callback_data: 'add_account' }]] }
    });
  }

  const bbApi = new BigBasketAPI(active.bb_access_token);
  const tokenInfo = bbApi.getTokenInfo();
  const accounts = accountOps.getAccounts(telegramId);

  let msg = `👤 *Active Account*\n\n`;
  msg += `📱 Phone: +91${active.phone_number}\n`;
  msg += `👤 Name: ${active.name || 'Unknown'}\n`;
  msg += `🆔 Member ID: ${active.bb_member_id || tokenInfo?.memberId || 'Unknown'}\n`;
  if (tokenInfo) {
    msg += `📅 Token Expires: ${tokenInfo.expiresAt || 'Unknown'}\n`;
    msg += `⏰ Status: ${tokenInfo.isExpired ? '⚠️ Expired' : '✅ Active'}\n`;
  }
  msg += `\n👥 Total accounts: ${accounts.length}`;

  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👥 My Accounts', callback_data: 'my_accounts' }],
        [{ text: '🛍️ Open Shop', callback_data: 'open_shop' }],
        [{ text: '➕ Add Account', callback_data: 'add_account' }],
      ]
    }
  });
}

// ==================== HELP ====================
async function sendHelp(chatId) {
  await bot.sendMessage(chatId,
    `🛒 *BigBasket Mini App - Help*\n\n` +
    `*How it works:*\n` +
    `1️⃣ Add your BigBasket account (phone + OTP)\n` +
    `2️⃣ Add multiple accounts if needed\n` +
    `3️⃣ Switch between accounts anytime\n` +
    `4️⃣ Open the Mini App to browse & shop\n\n` +
    `*Commands:*\n` +
    `• 👥 My Accounts - View & switch accounts\n` +
    `• ➕ Add Account - Login a new number\n` +
    `• 🛍️ Shop - Open the Mini App\n` +
    `• 👤 Profile - View active account info\n` +
    `• 📦 Orders - View order history\n` +
    `• 🚪 Logout - Remove active account\n\n` +
    `Each account keeps its own session permanently until you remove it.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add Account', callback_data: 'add_account' }],
          [{ text: '👥 My Accounts', callback_data: 'my_accounts' }],
        ]
      }
    }
  );
}

// ==================== MINI APP BUTTON ====================
async function sendMiniAppButton(chatId, name) {
  const miniAppUrl = process.env.MINI_APP_URL || `http://localhost:${process.env.PORT || 3000}/miniapp`;

  await bot.sendMessage(chatId,
    `🛒 *Open BigBasket*\n\nHey ${name || 'there'}, tap below to browse groceries!`,
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
