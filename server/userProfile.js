import { getUserSettings } from './db.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Best address for outbound mail (watchlist alerts, billing, account deletion). */
export function emailForNotifications(user) {
  if (!user) return null;
  for (const raw of [user.notification_email, user.email, user.username]) {
    const e = typeof raw === 'string' ? raw.trim() : '';
    if (e && EMAIL_RE.test(e)) return e;
  }
  return null;
}

/** How Ori (and the UI) should address the user — never a raw email when avoidable. */
export function displayNameFor(user, settings = null) {
  if (!user) return null;
  const s = settings ?? getUserSettings(user.username);
  const nick = typeof s?.nickname === 'string' ? s.nickname.trim() : '';
  if (nick) return nick.slice(0, 64);
  const un = user.username;
  if (un && EMAIL_RE.test(un)) return un.split('@')[0];
  if (user.email && EMAIL_RE.test(user.email)) return user.email.split('@')[0];
  return un || null;
}