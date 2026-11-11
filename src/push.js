const crypto = require('node:crypto');
const webpush = require('web-push');

// The Android app gets its notifications from Firebase Cloud Messaging (HTTP v1 API).
// FIREBASE_SERVICE_ACCOUNT holds the Firebase project's service account key (the JSON
// file, as is or base64). Without it, phones on the Android app get no notifications.
// The key file as pasted into a dashboard from a phone: real line breaks inside the
// private key (where the file has \n), curly quotes, or base64. Read all of them.
function readServiceAccount(raw) {
  let text = String(raw).trim().replace(/^\uFEFF/, '').replace(/[\u201C\u201D]/g, '"');
  if (!text.startsWith('{')) text = Buffer.from(text, 'base64').toString('utf8').trim();
  // Line breaks inside a quoted value become \n, as JSON needs; those between values stay.
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString && ch === '\\') { out += ch + (text[i + 1] ?? ''); i++; continue; }
    if (ch === '"') inString = !inString;
    if (inString && (ch === '\n' || ch === '\r')) { if (ch === '\n') out += '\\n'; continue; }
    out += ch;
  }
  const account = JSON.parse(out);
  if (typeof account.private_key === 'string') account.private_key = account.private_key.replace(/\\n/g, '\n');
  return account;
}

function createFcm(env, fetchImpl = globalThis.fetch) {
  let account = null;
  const rawKey = env.FIREBASE_SERVICE_ACCOUNT;
  if (rawKey) {
    try {
      account = readServiceAccount(rawKey);
    } catch (err) {
      // Never the key itself in the log: only its length and where it went wrong.
      console.warn(`FIREBASE_SERVICE_ACCOUNT could not be read (${String(rawKey).trim().length} characters, starts with "${String(rawKey).trim().slice(0, 1)}"; ${err.message.replace(/"[^"]*"/g, '…')}): Android app notifications are off.`);
    }
    const missing = account && ['project_id', 'client_email', 'private_key'].filter((k) => !account[k]);
    if (missing?.length) console.warn(`FIREBASE_SERVICE_ACCOUNT is missing ${missing.join(', ')}: paste the whole key file. Android app notifications are off.`);
    else if (account) console.log(`Android app notifications on (Firebase project ${account.project_id}).`);
  }
  if (!account?.client_email || !account?.private_key || !account?.project_id) return null;
  let token = null;
  let expires = 0;
  const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  async function accessToken() {
    if (token && Date.now() < expires - 60000) return token;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })}`;
    const jwt = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')}`;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    });
    if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status})`);
    const out = await res.json();
    token = out.access_token;
    expires = Date.now() + (out.expires_in || 3600) * 1000;
    return token;
  }
  return {
    // Resolves to false when the token is gone for good (the app was uninstalled).
    async send(fcmToken, payload) {
      const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token: fcmToken,
          notification: { title: String(payload.title || 'Africa Sportfishing'), body: String(payload.body || '') },
          data: { url: String(payload.url || '/') },
          android: { priority: 'high', notification: { channel_id: 'club' } },
        } }),
      });
      if (res.ok) return true;
      const text = await res.text().catch(() => '');
      if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return false;
      if (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return false;
      throw new Error(`Firebase ${res.status}: ${text.slice(0, 200)}`);
    },
  };
}

// Phone notifications (Web Push), used to tell the secretary there are fish
// to review. The VAPID keys that identify this server to the browsers' push
// services come from VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or are made on
// first start and kept in the database so subscriptions survive restarts.
function createPusher(db, { contact, env = process.env, fetchImpl } = {}) {
  const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  let publicKey = env.VAPID_PUBLIC_KEY || setting('vapid_public');
  let privateKey = env.VAPID_PRIVATE_KEY || setting('vapid_private');
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    const save = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    save.run('vapid_public', publicKey);
    save.run('vapid_private', privateKey);
  }
  const vapidDetails = { subject: `mailto:${contact || 'admin@example.com'}`, publicKey, privateKey };
  const fcm = createFcm(env, fetchImpl);
  return {
    publicKey,
    // Resolves to false when the subscription is gone for good (the person
    // turned notifications off or uninstalled), so it can be forgotten.
    async send(subscription, payload) {
      // The Android app: an "fcm:" endpoint is a Firebase token.
      if (subscription.endpoint.startsWith('fcm:')) return fcm ? fcm.send(subscription.endpoint.slice(4), payload) : true;
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), { vapidDetails, TTL: 24 * 60 * 60 });
        return true;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) return false;
        throw err;
      }
    },
  };
}

module.exports = { createPusher, readServiceAccount };
