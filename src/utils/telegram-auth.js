/**
 * Telegram WebApp initData Validation
 * 
 * Validates that requests from the Mini App actually come from Telegram.
 * Uses HMAC-SHA256 to verify the data_check_string against the bot token.
 * 
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
const crypto = require('crypto');

/**
 * Validate Telegram WebApp initData
 * @param {string} initData - The raw initData string from Telegram WebApp
 * @param {string} botToken - Your bot token from BotFather
 * @returns {{ valid: boolean, user: object|null, error: string|null }}
 */
function validateInitData(initData, botToken) {
  if (!initData || !botToken) {
    return { valid: false, user: null, error: 'Missing initData or botToken' };
  }

  try {
    // Parse the initData query string
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) {
      return { valid: false, user: null, error: 'No hash in initData' };
    }

    // Remove hash from params and sort alphabetically
    params.delete('hash');
    const dataCheckArr = [];
    params.sort();
    params.forEach((value, key) => {
      dataCheckArr.push(`${key}=${value}`);
    });
    const dataCheckString = dataCheckArr.join('\n');

    // Create HMAC-SHA256 secret key from bot token
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Calculate hash of data_check_string
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return { valid: false, user: null, error: 'Invalid hash - data may be tampered' };
    }

    // Parse user data
    const userStr = params.get('user');
    const user = userStr ? JSON.parse(decodeURIComponent(userStr)) : null;

    // Check auth_date is not too old (allow 24 hours)
    const authDate = parseInt(params.get('auth_date') || '0');
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      return { valid: false, user, error: 'initData expired (older than 24h)' };
    }

    return { valid: true, user, error: null };
  } catch (e) {
    return { valid: false, user: null, error: `Validation error: ${e.message}` };
  }
}

module.exports = { validateInitData };
