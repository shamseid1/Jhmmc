'use strict';

// Keeping the app's content decent (Apple's rule for apps where people post): anyone signed
// in can report a photo, a logged fish, an announcement or a profile; the officers get a
// notification, look at it on the Reports page and remove it or dismiss the report. Anyone
// can block a person, so that person's posts no longer show on their feed. Everyone agrees
// to the community rules once. Part of createApp (src/app.js).
module.exports = (ctx) => {
  const { api, auth, canReview, db, intId, isAdminUser, photoUrl, pushToReviewers, removeUpload, requireReview, str } = ctx;

  const REASONS = {
    offensive: 'Offensive or inappropriate',
    harassment: 'Harassment or abuse',
    spam: 'Spam or advertising',
    false: 'Not true or misleading',
    other: 'Something else',
  };
  const KINDS = ['log', 'catch', 'announcement', 'user'];

  // What was reported, as the officers see it: a line, a link and the photo if there is one.
  function target(kind, id) {
    if (kind === 'log') {
      const l = db.prepare(`SELECT l.id, l.photo, l.user_id AS userId, s.name AS species, l.fate, t.name AS boat, u.name AS by
        FROM outing_landings l JOIN outings o ON o.id = l.outing_id JOIN species s ON s.id = l.species_id
        LEFT JOIN teams t ON t.id = o.team_id LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?`).get(id);
      return l && { what: `${l.species} logged by ${l.boat || 'a boat'}${l.by ? ` (${l.by})` : ''}`, href: '#/', photoUrl: photoUrl(l.photo), userId: l.userId, removable: !!l.photo };
    }
    if (kind === 'catch') {
      const k = db.prepare(`SELECT k.id, k.photo, k.user_id AS userId, s.name AS species, t.name AS boat
        FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id WHERE k.id = ?`).get(id);
      return k && { what: `Photo of ${k.species} (${k.boat || 'a boat'})`, href: `#/catch/${k.id}`, photoUrl: photoUrl(k.photo), userId: k.userId, removable: !!k.photo };
    }
    if (kind === 'announcement') {
      const a = db.prepare('SELECT id, title, user_id AS userId FROM announcements WHERE id = ?').get(id);
      return a && { what: `Announcement "${a.title}"`, href: '#/?type=announcements', photoUrl: null, userId: a.userId, removable: true };
    }
    const u = db.prepare('SELECT id, name, photo, bio, nickname FROM users WHERE id = ?').get(id);
    return u && { what: `Profile of ${u.name}`, href: `#/user/${u.id}`, photoUrl: photoUrl(u.photo), userId: u.id, removable: !!(u.photo || u.bio || u.nickname) };
  }

  // ---- community rules ---------------------------------------------------
  api.post('/me/accept-rules', auth.requireUser, (req, res) => {
    db.prepare("UPDATE users SET rules_accepted_at = datetime('now') WHERE id = ? AND rules_accepted_at IS NULL").run(req.user.id);
    res.json({ ok: true });
  });

  // ---- reporting -----------------------------------------------------------
  api.post('/reports', auth.requireUser, (req, res) => {
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : null;
    const id = intId(req.body?.id);
    const reason = REASONS[req.body?.reason] ? req.body.reason : null;
    if (!kind || !id || !reason) return res.status(400).json({ error: 'Choose what is wrong with it.' });
    const t = target(kind, id);
    if (!t) return res.status(404).json({ error: 'That is no longer there.' });
    if (kind === 'user' && id === req.user.id) return res.status(400).json({ error: "That's your own profile." });
    const note = str(req.body.note, 500);
    // One open report per person per item: reporting again just updates it.
    const open = db.prepare("SELECT id FROM reports WHERE user_id = ? AND kind = ? AND target_id = ? AND status = 'open'").get(req.user.id, kind, id);
    if (open) db.prepare('UPDATE reports SET reason = ?, note = ? WHERE id = ?').run(reason, note, open.id);
    else {
      db.prepare('INSERT INTO reports (user_id, reporter_name, kind, target_id, reason, note) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.user.id, req.user.name, kind, id, reason, note);
      pushToReviewers({ title: 'Something was reported', body: `${REASONS[reason]}: ${t.what}`, url: '/#/reports' }, req.user);
    }
    res.status(201).json({ ok: true });
  });

  // The officers' list: open reports first, then the last ones dealt with.
  api.get('/reports', requireReview, (_req, res) => {
    const rows = db.prepare(`SELECT id, kind, target_id AS targetId, reason, note, status, reporter_name AS reporter, resolved_by AS resolvedBy,
        resolved_at AS resolvedAt, created_at AS createdAt FROM reports
      ORDER BY status = 'open' DESC, id DESC LIMIT 100`).all();
    res.json({
      reports: rows.map((r) => ({ ...r, reasonText: REASONS[r.reason], target: target(r.kind, r.targetId) || { what: 'Already removed', removable: false } })),
      open: rows.filter((r) => r.status === 'open').length,
    });
  });

  // Remove what was reported, or dismiss the report. Every report about the same item closes with it.
  api.post('/reports/:id/resolve', requireReview, (req, res) => {
    const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    const remove = req.body?.action === 'remove';
    const t = target(r.kind, r.target_id);
    if (remove && t) {
      if (r.kind === 'log') {
        const l = db.prepare('SELECT photo FROM outing_landings WHERE id = ?').get(r.target_id);
        db.prepare('UPDATE outing_landings SET photo = NULL, on_profile = 0 WHERE id = ?').run(r.target_id);
        removeUpload(l?.photo);
      } else if (r.kind === 'catch') {
        const k = db.prepare('SELECT photo FROM catches WHERE id = ?').get(r.target_id);
        db.prepare('UPDATE catches SET photo = NULL WHERE id = ?').run(r.target_id);
        removeUpload(k?.photo);
      } else if (r.kind === 'announcement') {
        db.prepare('DELETE FROM announcements WHERE id = ?').run(r.target_id);
      } else {
        const u = db.prepare('SELECT photo FROM users WHERE id = ?').get(r.target_id);
        db.prepare('UPDATE users SET photo = NULL, bio = NULL, nickname = NULL WHERE id = ?').run(r.target_id);
        removeUpload(u?.photo);
      }
    }
    const status = remove ? 'removed' : 'dismissed';
    db.prepare(`UPDATE reports SET status = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE kind = ? AND target_id = ? AND status = 'open'`).run(status, req.user.name, r.kind, r.target_id);
    db.prepare('INSERT INTO activity_log (user_id, user_name, role, action, details) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, req.user.name, isAdminUser(req.user) ? 'admin' : req.user.role || null,
        `Report: ${remove ? 'removed' : 'no action for'} ${t ? t.what : 'an item already gone'}`, `${REASONS[r.reason]}${r.note ? `: ${r.note}` : ''}`);
    res.json({ ok: true });
  });

  // ---- blocking -------------------------------------------------------------
  api.post('/blocks', auth.requireUser, (req, res) => {
    const id = intId(req.body?.userId);
    if (!id || id === req.user.id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
      return res.status(400).json({ error: "That person can't be blocked." });
    }
    db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)').run(req.user.id, id);
    res.status(201).json({ ok: true });
  });
  api.delete('/blocks/:id', auth.requireUser, (req, res) => {
    db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(req.user.id, intId(req.params.id) ?? 0);
    res.json({ ok: true });
  });

  // Who someone has blocked, for /me and the feed.
  const blockedBy = (userId) => (userId ? db.prepare('SELECT blocked_id AS id FROM blocks WHERE user_id = ?').all(userId).map((b) => b.id) : []);
  const openReports = (user) => (user && (canReview(user) || isAdminUser(user)) ? db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n : 0);
  return { blockedBy, openReports };
};
