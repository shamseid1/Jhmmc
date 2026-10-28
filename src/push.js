const webpush = require('web-push');

// Phone notifications (Web Push), used to tell the secretary there are fish
// to review. The VAPID keys that identify this server to the browsers' push
// services come from VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or are made on
// first start and kept in the database so subscriptions survive restarts.
function createPusher(db, { contact, env = process.env } = {}) {
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
  return {
    publicKey,
    // Resolves to false when the subscription is gone for good (the person
    // turned notifications off or uninstalled), so it can be forgotten.
    async send(subscription, payload) {
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

module.exports = { createPusher };
