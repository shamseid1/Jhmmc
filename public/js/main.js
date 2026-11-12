// Africa Sportfishing, part of the app (public/js/main.js): The router, notifications, installing, the theme and starting the app.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

// ---- pages ----------------------------------------------------------------

// Each navigation renders into its own element, so a slow page that finishes
// after the user has moved on writes into a detached node instead.
const pagesFor = (view) => Object.assign({}, ...PAGE_GROUPS.map((group) => group(view)));

// ---- router ---------------------------------------------------------------

// Icons from Lucide (lucide.dev, ISC licence), 24px grid, drawn with currentColor.
const ICONS = {
  wave: '<path d="M2 6c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M2 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M2 18c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  feed: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  leaderboard: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  participants: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clubs: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  catch: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  weight: '<circle cx="12" cy="5" r="3"/><path d="M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z"/>',
  review: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  // The marlin from the logo, filled (Log fish).
  fish: '<use href="/marlin.svg#m" x="-3" y="-3" width="30" height="30" style="fill:currentColor;stroke:none"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  brush: '<path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"/><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  // A sportfisher, head-on (the boat mark in boat.svg).
  boat: '<use href="/boat.svg#b" x="-2.5" y="-2.5" width="29" height="29" style="fill:currentColor;stroke:none"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  rules: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
};

// Bar graph of season points, one bar per boat. Bars grow from zero, so a
// boat below zero (a small marlin kept) points left. The value sits at the
// bar's end; hovering shows the fish count too.
const TOP_BARS = 10;
// A bar's number: just past its end, or inside the end of the longest bars, where
// there's no room after them (big text on a narrow phone).
const barValue = (points, neg, from, to) => {
  const inside = neg ? from < 30 : to > 70;
  const where = neg === inside ? `left:${inside ? from : to}%` : `right:${100 - (neg ? from : to)}%`;
  return `<span class="bar-value${neg ? ' neg' : ''}${inside ? ' in' : ''}" style="${where}">${points}</span>`;
};
function pointsBars(boats) {
  const lo = Math.min(0, ...boats.map((b) => b.points));
  const hi = Math.max(0, ...boats.map((b) => b.points));
  // Room at either end for the value label.
  const left = lo < 0 ? 16 : 0;
  const right = hi > 0 ? 16 : 0;
  const scale = (v) => left + ((v - lo) / (hi - lo || 1)) * (100 - left - right);
  const zero = scale(0);
  return boats.map((b) => {
    const end = scale(b.points);
    const neg = b.points < 0;
    const [from, to] = neg ? [end, zero] : [zero, end];
    return html`<a class="bar-row" href="#/boat/${b.teamId}" title="${b.teamName}: ${b.points} points from ${plural(b.catches, 'fish')}">
      <span class="bar-name">${b.teamName}</span>
      <span class="bar-track" style="--zero:${zero}%">
        <span class="bar${neg ? ' neg' : ''}" style="left:${from}%;width:${Math.max(to - from, 0.5)}%"></span>
        ${raw(barValue(b.points, neg, from, to))}
      </span></a>`;
  }).join('');
}

// ---- review badge & phone notifications ----------------------------------

// How many registrations wait for the secretary: shown on the More tab, the
// Review catches menu item and the browser tab's title.
async function refreshPending() {
  const before = state.pending;
  try {
    state.pending = state.me?.canApprove ? (await api('/officials/pending')).count : 0;
  } catch {
    return;
  }
  document.title = `${state.pending ? `(${state.pending}) ` : ''}Africa Sportfishing`;
  if (state.pending !== before) renderNav();
}
setInterval(() => { if (document.visibilityState === 'visible') refreshPending(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPending(); });

const pushSupported = () => NATIVE || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);

// 'granted', 'denied' or 'default', from the browser or, in the Android app, from Android.
async function notifyPermission() {
  if (NATIVE) {
    try { const r = (await native('PushNotifications', 'checkPermissions')).receive; return r === 'granted' || r === 'denied' ? r : 'default'; } catch { return 'default'; }
  }
  return Notification.permission;
}

// The Android app: Firebase gives the phone a token; the server sends notifications to it.
const FCM_KEY = 'fcm-token';
const fcmWaiting = [];
if (NATIVE) {
  nativeListen('PushNotifications', 'registration', (r) => fcmWaiting.splice(0).forEach((w) => w.resolve(r?.value)));
  nativeListen('PushNotifications', 'registrationError', (e) => fcmWaiting.splice(0).forEach((w) => w.reject(new Error(e?.error || 'Notifications could not be set up.'))));
  // Tapping a notification opens the page it's about.
  nativeListen('PushNotifications', 'pushNotificationActionPerformed', (a) => {
    const url = a?.notification?.data?.url;
    if (url && url.startsWith('/')) location.href = url;
  });
  // Opening the app clears its notifications from the phone (and the number on the app's icon).
  const clearDelivered = () => { if (document.visibilityState === 'visible') native('PushNotifications', 'removeAllDeliveredNotifications').catch(() => {}); };
  clearDelivered();
  document.addEventListener('visibilitychange', clearDelivered);
  // In the app already: Android doesn't show it, so a toast does (the iPhone shows its banner).
  if (!IOS_APP) nativeListen('PushNotifications', 'pushNotificationReceived', (n) => { if (n?.title) toast(n.body ? `${n.title}: ${n.body}` : n.title); });
}
function fcmToken() {
  return new Promise((resolve, reject) => {
    fcmWaiting.push({ resolve, reject });
    native('PushNotifications', 'register').catch(reject);
    setTimeout(() => reject(new Error('Notifications could not be set up. Try again.')), 20000);
  });
}
// Android's token is Firebase's; the iPhone's is Apple's.
const tokenBody = (token) => (IOS_APP ? { apns: token } : { fcm: token });
const savedFcm = () => { try { return localStorage.getItem(FCM_KEY); } catch { return null; } };
// Firebase can change a phone's token: each start of the app, the current one goes to the server.
if (NATIVE && savedFcm()) {
  setTimeout(async () => {
    try {
      if ((await notifyPermission()) !== 'granted' || !state.me) return;
      const token = await fcmToken();
      try { localStorage.setItem(FCM_KEY, token); } catch { /* fine */ }
      await api('/push/subscribe', { method: 'POST', body: tokenBody(token) });
    } catch { /* tried again next start */ }
  }, 4000);
}

function pushKey(base64) {
  const raw = atob((base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Asks the phone (its Allow / Don't allow) and, if allowed, registers it with the server.
async function enablePush() {
  if (NATIVE) {
    let r = (await native('PushNotifications', 'checkPermissions')).receive;
    if (r !== 'granted') r = (await native('PushNotifications', 'requestPermissions')).receive;
    if (r !== 'granted') return false;
    const token = await fcmToken();
    try { localStorage.setItem(FCM_KEY, token); } catch { /* registered again next time */ }
    await api('/push/subscribe', { method: 'POST', body: tokenBody(token) });
    return true;
  }
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const { reg } = await pushSubscription();
  const { publicKey } = await api('/push/key');
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey(publicKey) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return true;
}

async function pushSubscription() {
  if (NATIVE) {
    // The same shape as the browser's subscription.
    const token = (await notifyPermission()) === 'granted' ? savedFcm() : null;
    return { sub: token && {
      endpoint: IOS_APP ? `apns:${token.toLowerCase()}` : `fcm:${token}`,
      toJSON: () => tokenBody(token),
      unsubscribe: async () => { try { localStorage.removeItem(FCM_KEY); } catch { /* fine */ } await native('PushNotifications', 'unregister').catch(() => {}); },
    } };
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

// Signing out: this phone stops getting that account's notifications, and nothing of that
// account stays shown (its saved copy is cleared, here and in the offline copy).
async function signOut() {
  try {
    const { sub } = await pushSubscription();
    if (sub) await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  } catch { /* the server forgets it anyway when it's gone */ }
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  state.clubs = null;
  try { localStorage.removeItem('kept-me'); } catch { /* fine */ }
  try { for (const key of await caches.keys()) await (await caches.open(key)).delete('/api/me'); } catch { /* no offline copy */ }
}
// Signed in (or a new account): this phone's notifications now go to that account.
async function afterSignIn() {
  try {
    if (!pushSupported() || (await notifyPermission()) !== 'granted') return;
    const { sub } = await pushSubscription();
    if (sub) await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  } catch { /* set again from More → Notifications */ }
}

// The "notifications on this phone" switch: on More for everyone (announcements),
// on the Review page for officials (fish to review), and on the feed until it's on.
async function renderNotify(el, { what = 'a captain registers fish', hideWhenOn = false } = {}) {
  // On the feed it's only an offer: nothing if this phone can't, or won't, have them.
  const permission = pushSupported() ? await notifyPermission() : 'default';
  if (hideWhenOn && (!pushSupported() || permission === 'denied')) return;
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!pushSupported()) {
    el.innerHTML = iphone && !installed
      ? `<p><b>Get notifications for ${what}.</b></p><p class="small muted">On iPhone, first add this app to your Home Screen: tap the Share button, then <b>Add to Home Screen</b>. Open the app from the Home Screen and come back to this page.</p>`
      : '<p class="small muted">This browser can\'t show notifications. Chrome on Android, or the app added to an iPhone Home Screen, can.</p>';
    return;
  }
  if (permission === 'denied') {
    el.innerHTML = isInstalled()
      ? `<p class="small muted">Notifications are blocked on this phone. Turn them on in ${esc(appSettings('Notifications'))}, then come back here.</p>`
      : '<p class="small muted">Notifications are blocked for this site. Allow them in your browser\'s site settings, then come back here.</p>';
    return;
  }
  const { sub } = await pushSubscription();
  if (sub && hideWhenOn) {
    el.innerHTML = '';
    el.className = '';
    api('/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {});
    return;
  }
  // Re-send a live subscription, in case the server forgot it.
  if (sub) api('/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {});
  el.innerHTML = sub
    ? `<p class="small muted">${icon('check')} Notifications on for this phone · <button class="link" data-act="push-off">Turn off</button></p>`
    : `<div class="notify-row"><span><b>Get notifications</b> on this phone for ${what}.</span><button class="primary" data-act="push-on">Turn on notifications</button></div>`;
  // Once on, it's a quiet line rather than a card.
  el.classList.toggle('card', !sub);
  el.classList.toggle('pad', !sub);
  el.classList.toggle('notify-on', !!sub);
  el.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (btn.dataset.act === 'push-on') {
        toast(await enablePush() ? 'Notifications are on' : 'Notifications were not allowed.');
      } else {
        await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
        toast('Notifications are off');
      }
    } catch (ex) {
      toast(ex.message || 'Could not change notifications.');
    }
    renderNotify(el, { what, hideWhenOn });
  };
}

function renderNav(active = state.navActive) {
  state.navActive = active;
  syncHeader();
  // One bar for everyone. Captains and officials do the weigh-in from More (or the feed's card).
  const me0 = state.me;
  const links = [
    ['#/', 'Feed', 'home', 'feed'],
    ['#/leaderboard', 'Leaderboard', 'leaderboard', 'leaderboard'],
    ...(me0?.teamId ? [['#/fishon', 'Log fish', 'fishon', 'fish', 'cta']] : []),
    ['#/participants', 'Participants', 'participants', 'participants'],
  ];
  links.push(['#/more', 'More', 'more', 'more']);
  const current = {
    boat: 'participants', user: 'participants', guest: 'participants', weigh: 'more',
    records: 'leaderboard', points: 'leaderboard', join: 'more', weighmasters: 'more', tournament: 'leaderboard', enter: 'leaderboard', sheet: 'more', 'tournament-sheets': 'more',
    'points-fish': 'leaderboard', scoring: 'more', new: 'home', edit: 'home', rules: 'more', install: 'more', spots: 'more', outing: 'more', log: 'more',
    clubs: 'more', club: 'more', profile: 'more', reports: 'more', community: 'more', sea: 'more', depth: 'more', currents: 'more', crew: 'more', login: 'more', register: 'more', forgot: 'more', reset: 'more', members: 'more',
    'admin-boats': 'more', backups: 'more', activity: 'more', desk: 'more', 'club-members': 'more', notifications: 'more', pending: 'more', history: 'more', review: 'more', calendar: 'more',
    // The officials' Tournament sheets live in More; the Tournaments tab in the Leaderboard.
    tournaments: /[?&]sheets=1/.test(location.hash) ? 'more' : 'leaderboard',
  }[active] || active;
  document.getElementById('nav').innerHTML = links
    .map(([href, label, key, icon, cls]) => `<a href="${href}" class="${cls || ''}"${key === current ? ' aria-current="page"' : ''}${key === 'more' ? ' data-nav="more"' : ''}>
      <span class="nav-icon">${icon === 'fish' ? '<span class="fish-mark" aria-hidden="true"></span>' : `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`}${key === 'more' && state.pending
        ? `<span class="count-badge" aria-label="${state.pending} to review">${state.pending > 99 ? '99+' : state.pending}</span>` : ''}</span><span>${label}</span></a>`)
    .join('');
  fitNav();
}

// The phone tab bar: if a label doesn't fit (a narrow phone, or the phone's text made
// bigger), the labels get a little smaller until every one fits whole.
function fitNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.style.removeProperty('--nav-fs');
  if (innerWidth > 640) return;
  const labels = [...nav.querySelectorAll('a > span:last-child')];
  const fits = () => labels.every((s) => s.scrollWidth <= s.clientWidth + 0.5);
  for (let size = 10.5; !fits() && size >= 7; size -= 0.5) nav.style.setProperty('--nav-fs', `${size}px`);
}
window.addEventListener('resize', fitNav);
// Measured again once the app's font has loaded (it's wider than the stand-in).
document.fonts?.ready.then(fitNav);

async function route() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', arg] = path.split('/');
  const view = document.createElement('div');
  const pages = pagesFor(view);
  let page = Object.hasOwn(pages, name) ? name : 'home';
  if (state.me && (page === 'login' || page === 'register') && !(page === 'login' && state.meta?.demo)) page = 'home';
  renderNav(page);
  refreshPending();
  // A photo or an explanation left open doesn't follow to the next page.
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  main.replaceChildren(view);
  window.scrollTo(0, 0);
  try {
    await pages[page](arg);
    rulesCheck().catch(() => {});
    firstOpenSetup().catch(() => {});
  } catch (ex) {
    view.innerHTML = html`<div class="card pad empty"><p>${ex.message}</p><a href="#/">Back to the feed</a></div>`;
  }
}

// Auto, light or dark: chosen with the brush on More. Auto follows the phone's own
// setting (light if it has none) and is where everyone starts.
const THEME_COLORS = { dark: '#001a43', light: '#f4f6fa' };
// A new key each time everyone is reset: everyone moved to light mode once
// (choices saved under 'theme' and 'appearance' no longer count).
const THEME_KEY = 'look';
try {
  localStorage.removeItem('theme');
  localStorage.removeItem('appearance');
  localStorage.removeItem('jhmmc-feed'); // the two sides are one now
} catch {
  // Nothing saved, nothing to clear.
}
const phoneDark = matchMedia('(prefers-color-scheme: dark)');
const themeChoice = () => {
  try {
    // New phones start in light mode; Auto (follow the phone) only when picked.
    const t = localStorage.getItem(THEME_KEY);
    return t === 'dark' || t === 'auto' ? t : 'light';
  } catch {
    return 'light';
  }
};
function applyTheme(choice = themeChoice()) {
  const theme = choice === 'auto' ? (phoneDark.matches ? 'dark' : 'light') : choice;
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLORS[theme]);
  // Light is "only light" so a browser's own dark mode (Samsung Internet) leaves it light.
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', theme === 'light' ? 'only light' : 'dark');
  // The phone apps: the clock and battery icons dark on the light page, light on the dark one.
  if (NATIVE) native('SystemBars', 'setStyle', { style: theme === 'light' ? 'LIGHT' : 'DARK' }).catch(() => {});
}
applyTheme();
// Following the phone: change when the phone does.
phoneDark.addEventListener('change', () => {
  if (themeChoice() === 'auto') applyTheme('auto');
});
const themeButton = () => {
  const now = themeChoice();
  const choice = (value, iconName, label) => `<button type="button" role="menuitemradio" data-theme-choice="${value}" aria-checked="${now === value}">
    ${icon(iconName)} ${label}${now === value ? `<span class="tick">${icon('check')}</span>` : ''}</button>`;
  return `<div class="theme-pick">
    <button type="button" class="theme-btn" aria-label="Appearance: auto (the phone's setting), light or dark" aria-haspopup="true" aria-expanded="false">${icon('brush')}</button>
    <div class="theme-menu" role="menu" hidden>${choice('auto', 'settings', 'Auto')}${choice('light', 'sun', 'Light')}${choice('dark', 'moon', 'Dark')}</div></div>`;
};
// The brush on More opens the choice; a tap anywhere else closes it.
document.addEventListener('click', (e) => {
  const pick = e.target.closest('.theme-pick');
  for (const open of document.querySelectorAll('.theme-pick')) {
    if (open !== pick) {
      open.querySelector('.theme-menu').hidden = true;
      open.querySelector('.theme-btn').setAttribute('aria-expanded', 'false');
    }
  }
  if (!pick) return;
  const choice = e.target.closest('[data-theme-choice]');
  if (!choice) {
    const menu = pick.querySelector('.theme-menu');
    menu.hidden = !menu.hidden;
    pick.querySelector('.theme-btn').setAttribute('aria-expanded', String(!menu.hidden));
    return;
  }
  const value = choice.dataset.themeChoice;
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  applyTheme(value);
  pick.outerHTML = themeButton();
});

// ---- installing the app (a PWA) ----------------------------------------------

// The service worker makes the app installable and lets it open without signal.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// Chrome, Edge and Samsung Internet offer their own install prompt; it's kept
// for the Install button on More. iPhones are shown how instead.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  document.querySelector('[data-install-ready]')?.removeAttribute('hidden');
});
// The Install button on More: the browser's own install where it offers one,
// otherwise the steps for this phone.
async function installApp() {
  if (!installPrompt) {
    location.hash = '#/install';
    return;
  }
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === 'accepted') document.querySelector('.install-card')?.remove();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-install]')) installApp();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  document.querySelector('.install-card')?.remove();
  toast('Installed. Open Africa Sportfishing from your home screen.');
});
const isInstalled = () => NATIVE || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// In the installed app (signed in), a sheet asks for what it needs: notifications and
// the phone's location. A page can only ask when someone taps, so each is a button;
// Android then shows its own Allow / Don't allow. Where the phone already said no, the
// sheet says where to switch it back on. It comes back once a day until both are
// allowed, then never again (the app's data survives reinstalling, so "once" wasn't enough).
const SETUP_KEY = 'setup-shown-at';
async function firstOpenSetup() {
  if (!isInstalled() || !state.me || document.getElementById('setup-sheet')) return;
  try { if (Date.now() - Number(localStorage.getItem(SETUP_KEY) || 0) < 864e5) return; } catch { return; }
  const notifyOn = pushSupported() && (await notifyPermission()) === 'granted' && !!(await pushSubscription().catch(() => ({}))).sub;
  // Nothing missing: no sheet.
  if ((notifyOn || !pushSupported()) && (await locationPermission()) === 'granted') return;
  const dlg = document.createElement('dialog');
  dlg.id = 'setup-sheet';
  const row = (key, title, sub, done, blocked) => html`<div class="setup-row" data-row="${key}">
    <span><b>${title}</b><span class="small muted">${sub}</span></span>
    ${done ? raw(`<span class="setup-done">${icon('check')}</span>`)
    : blocked ? raw(html`<span class="small setup-blocked">Blocked: ${blocked}</span>`)
      : raw(html`<button type="button" class="primary" data-ask="${key}">Allow</button>`)}</div>`;
  const draw = async () => {
    const loc = await locationPermission();
    const notify = pushSupported() ? await notifyPermission() : 'default';
    dlg.innerHTML = html`<h2>Set up the app</h2>
      <p class="small muted">Two quick permissions so it works at sea and tells you what's happening.</p>
      ${raw(pushSupported() ? row('notify', 'Notifications', 'Weigh-ins, fish logged and club announcements',
        notifyOn || (notify === 'granted' && dlg.dataset.notify === 'on'),
        notify === 'denied' ? `${appSettings('Notifications')} → Allow` : '') : '')}
      ${raw(row('location', 'Location', 'The spot of each fish you log, for your crew only',
        loc === 'granted', loc === 'denied' ? `${appSettings('Location')} → ${IOS_APP ? 'While Using the App' : 'Allow'}` : ''))}
      <button type="button" class="setup-close">Done</button>`;
  };
  await draw();
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('.setup-close') || e.target === dlg) { dlg.close(); return; }
    const btn = e.target.closest('[data-ask]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (btn.dataset.ask === 'notify') { if (await enablePush()) dlg.dataset.notify = 'on'; }
      else await new Promise((done) => navigator.geolocation.getCurrentPosition(done, done, { timeout: 15000 }));
    } catch { /* the row says what to do */ }
    await draw();
  });
  dlg.addEventListener('close', () => { try { localStorage.setItem(SETUP_KEY, String(Date.now())); } catch { /* asked again next time */ } dlg.remove(); });
  document.body.append(dlg);
  dlg.showModal();
}

// "Sign in" links inside a page come back to that page afterwards.
document.addEventListener('click', (e) => {
  if (e.target.closest('a[data-return]')) state.afterLogin = location.hash;
});

// Without signal, pictures that aren't on the phone are hidden rather than shown broken.
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && navigator.onLine === false) e.target.hidden = true;
}, true);
// Signal back: a page that couldn't load tries again.
window.addEventListener('online', () => {
  if (document.querySelector('.offline-note, .feed-list .empty')) route();
});

// No signal: a thin bar says so, instead of errors; it goes when the signal is back.
function showOffline() {
  let bar = document.getElementById('offline-bar');
  if (navigator.onLine !== false) { bar?.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'offline-bar';
  bar.setAttribute('role', 'status');
  bar.textContent = 'Offline. Fish you log are saved and sent when you’re back in range.';
  document.body.append(bar);
}
window.addEventListener('offline', showOffline);
window.addEventListener('online', showOffline);
showOffline();

// Pull down at the top of a page to refresh it, like other apps.
(() => {
  let startY = null; let dy = 0; let spin = null;
  // Only on pages that just show things: redrawing a form (a weigh-in half filled in) would empty it.
  const REFRESHABLE = new Set(['', 'leaderboard', 'tournaments', 'tournament', 'records', 'participants', 'boat', 'user', 'guest', 'catch',
    'log', 'spots', 'pending', 'history', 'activity', 'desk', 'review', 'points-fish', 'club', 'clubs']);
  const skip = (t) => !REFRESHABLE.has(location.hash.replace(/^#\/?/, '').split(/[/?]/)[0])
    || t.closest('.leaflet-container, input, textarea, select, dialog, form, details[open], .gallery, .hour-bars')
    // ...or anything typed and not yet sent (a note for a correction).
    || [...document.querySelectorAll('main input:not([type=hidden]):not([type=search]):not([type=checkbox]):not([type=radio]):not([type=file]), main textarea')]
      .some((el) => el.value !== el.defaultValue);
  document.addEventListener('touchstart', (e) => {
    startY = window.scrollY <= 0 && e.touches.length === 1 && !skip(e.target) ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { spin?.remove(); spin = null; return; }
    if (!spin) {
      spin = document.createElement('div');
      spin.className = 'ptr';
      spin.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>`;
      document.body.append(spin);
    }
    const pull = Math.min(dy / 2.2, 80);
    spin.style.transform = `translate(-50%, ${pull}px) rotate(${dy * 1.5}deg)`;
    spin.classList.toggle('ready', pull >= 64);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!spin) return;
    const el = spin; spin = null;
    if (el.classList.contains('ready')) {
      el.classList.add('spinning');
      buzz('light');
      try { await route(); } finally { el.remove(); }
    } else el.remove();
    startY = null;
  });
})();

(async function init() {
  [state.meta] = await Promise.all([
    api('/meta').then((m) => (keep('kept-meta', m), m)).catch((err) => {
      const m = kept('kept-meta');
      if (!m) throw err;
      return m;
    }),
    refreshMe(),
  ]);
  // The demo copy: everyone arrives signed in as the captain of its first boat, and every page says it's a demo.
  if (state.meta.demo) {
    if (!state.me) {
      try {
        const [captain] = (await api('/demo')).accounts;
        state.me = (await api('/auth/login', { method: 'POST', body: { email: captain.email, password: captain.password } })).user;
        keep('kept-me', state.me);
      } catch {
        // Signed out after all: the sign-in page lists the demo accounts.
      }
    }
    document.querySelector('.topbar')?.insertAdjacentHTML('afterend',
      '<div class="demo-bar">Demo copy: made-up data. <a href="#/login">Try it as a captain, an angler or the secretary</a></div>');
  }
  window.addEventListener('hashchange', route);
  route();
})();
