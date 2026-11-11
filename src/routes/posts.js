'use strict';

// A post's photos and video, editing posts. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    CATCH_SELECT, api, auth, bool, canReview, checkCatch, db, discardUploads, intId, logRegistration,
    mediaUploads, photoUrl, present, pushWhere, removeUpload, str, unlogRegistration, upload
  } = ctx;

  // ---- more photos on a post, and editing posts --------------------------

  const extraPhotos = db.prepare('SELECT id, file FROM post_photos WHERE kind = ? AND post_id = ? ORDER BY id');
  // A post's photos, the first one (its own photo column) as "cover".
  const postPhotos = (kind, id, cover) => [
    ...(cover ? [{ id: 'cover', url: photoUrl(cover) }] : []),
    ...extraPhotos.all(kind, id).map((x) => ({ id: x.id, url: photoUrl(x.file) })),
  ];
  function dropPostPhotos(kind, id) {
    for (const x of extraPhotos.all(kind, id)) removeUpload(x.file);
    db.prepare('DELETE FROM post_photos WHERE kind = ? AND post_id = ?').run(kind, id);
  }
  const MAX_PHOTOS = 10;
  const editUpload = mediaUploads(MAX_PHOTOS + 1).fields([{ name: 'photos', maxCount: MAX_PHOTOS }, { name: 'video', maxCount: 1 }]);
  // New photos, removed photos ("removePhotos": ids, "cover" for the first) and a
  // new or removed video ("removeVideo"), applied to a post whose photo and video
  // live in `table`. Returns an error, or null once done.
  function editMedia(req, kind, table, row) {
    const added = req.files?.photos ?? [];
    const video = req.files?.video?.[0];
    let remove = [];
    try {
      remove = JSON.parse(req.body.removePhotos || '[]');
    } catch {
      return 'The photos to remove could not be read.';
    }
    const extras = extraPhotos.all(kind, row.id);
    const gone = extras.filter((x) => remove.includes(x.id));
    const kept = extras.length - gone.length + (row.photo && !remove.includes('cover') ? 1 : 0);
    if (kept + added.length > MAX_PHOTOS) return `At most ${MAX_PHOTOS} photos on a post.`;
    let cover = row.photo;
    if (cover && remove.includes('cover')) {
      removeUpload(cover);
      cover = null;
    }
    for (const x of gone) {
      removeUpload(x.file);
      db.prepare('DELETE FROM post_photos WHERE id = ?').run(x.id);
    }
    const addExtra = db.prepare('INSERT INTO post_photos (kind, post_id, file) VALUES (?, ?, ?)');
    for (const f of added) {
      if (!cover) cover = f.filename;
      else addExtra.run(kind, row.id, f.filename);
    }
    // No cover left: the next photo moves up.
    if (!cover) {
      const next = extraPhotos.get(kind, row.id);
      if (next) {
        cover = next.file;
        db.prepare('DELETE FROM post_photos WHERE id = ?').run(next.id);
      }
    }
    let newVideo = row.video;
    if (video || bool(req.body.removeVideo)) {
      removeUpload(row.video);
      newVideo = video?.filename ?? null;
    }
    db.prepare(`UPDATE ${table} SET photo = ?, video = ? WHERE id = ?`).run(cover, newVideo, row.id);
    return null;
  }

  // Edit a West Africa post: add the weight, more photos, the spot... once back
  // on land. JHMMC registrations can't be edited (they're withdrawn instead).
  api.patch('/catches/:id', editUpload, (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user);
    if (!item) {
      discardUploads(req);
      return res.status(404).json({ error: 'Catch not found.' });
    }
    if (!item.canEdit) {
      discardUploads(req);
      return res.status(403).json({ error: item.status !== 'unofficial'
        ? "A JHMMC registration can't be edited; ask the secretary."
        : 'Only the angler, whoever logged it, or the boat captain can edit this catch.' });
    }
    const b = req.body;
    const has = (k) => k in b;
    // The stored spot, whether or not this person may see it.
    const row = db.prepare('SELECT id, photo, video, lat, lng FROM catches WHERE id = ?').get(id);
    // Checked like a new post, from what's sent and what the post already has.
    const merged = {
      speciesId: has('speciesId') ? b.speciesId : item.speciesId,
      anglerId: 'other', anglerName: item.angler, // the angler isn't changed here
      weightKg: has('weightKg') ? b.weightKg : item.weightKg ?? '',
      lengthCm: has('lengthCm') ? b.lengthCm : item.lengthCm ?? '',
      caughtOn: has('caughtOn') ? b.caughtOn : item.caughtOn,
      lineClass: has('lineClass') ? b.lineClass : item.lineClass ?? '',
      country: has('country') ? b.country : item.country ?? '',
      location: has('location') ? b.location : item.location ?? '',
      notes: has('notes') ? b.notes : item.notes ?? '',
      released: has('released') ? b.released : item.released ? 'on' : '',
      tagged: has('tagged') ? b.tagged : item.tagged ? 'on' : '',
      spotPublic: has('spotPublic') ? b.spotPublic : item.spotPublic ? 'on' : '',
      lat: has('lat') ? b.lat : row.lat ?? '',
      lng: has('lng') ? b.lng : row.lng ?? '',
    };
    const checked = checkCatch(req.user, merged, {}, { teamId: item.teamId, official: false });
    if (checked.error) {
      discardUploads(req);
      return res.status(400).json({ error: checked.error });
    }
    const v = checked.values;
    db.exec('BEGIN');
    try {
      const mediaError = editMedia(req, 'catch', 'catches', row);
      if (mediaError) throw Object.assign(new Error(mediaError), { status: 400 });
      db.prepare(`UPDATE catches SET species_id = ?, weight_kg = ?, length_cm = ?, released = ?, tagged = ?, caught_on = ?,
        country = ?, location = ?, line_class = ?, notes = ?, lat = ?, lng = ?, spot_public = ? WHERE id = ?`)
        .run(v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[21], v[22], v[23], id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      discardUploads(req);
      if (err.status === 400) return res.status(400).json({ error: err.message });
      throw err;
    }
    res.json({ catch: getCatch(id, req.user) });
  });

  function getCatch(id, viewer) {
    const row = db.prepare(`${CATCH_SELECT} WHERE k.id = :id`).get({ id });
    return row ? present(row, viewer) : null;
  }

  api.get('/catches/:id', (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user);
    if (!item) return res.status(404).json({ error: 'Catch not found.' });
    res.json({ catch: item });
  });

  api.delete('/catches/:id', (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user);
    if (!item) return res.status(404).json({ error: 'Catch not found.' });
    if (!item.canDelete) {
      return res.status(403).json({ error: item.status !== 'unofficial'
        ? 'This is a JHMMC registration; ask the secretary to remove it.'
        : 'Only the angler, whoever logged it, or the boat captain can delete this catch.' });
    }
    if (item.status !== 'unofficial') {
      const withdrawn = item.loggedBy === req.user.id && !canReview(req.user);
      // The secretary (or admin) deleting a registration says why: it stays on record.
      const reason = str(req.body?.reason, 300);
      if (!withdrawn && !reason) return res.status(400).json({ error: 'Give a reason for deleting it; it stays in the registration record.' });
      logRegistration(id, withdrawn ? 'withdrawn' : 'deleted', req.user, { note: reason });
      unlogRegistration(id);
      if (!withdrawn && item.loggedBy && item.loggedBy !== req.user.id) {
        pushWhere('myFish', {
          title: 'Fish removed',
          body: `Your ${item.species}${item.weightKg ? ` (${Math.round(item.weightKg * 10) / 10} kg)` : ''} was removed by the secretary: ${reason}`,
          url: '/#/more',
        }, req.user, (p) => p.id === item.loggedBy);
      }
    }
    db.prepare('DELETE FROM catches WHERE id = ?').run(id);
    // A registration's scale photo and video stay as evidence in the record.
    removeUpload(item.photo);
    dropPostPhotos('catch', id);
    removeUpload(item.video);
    res.json({ ok: true });
  });

  // A weighed fish's photo for the feed, added or changed at any time by the
  // angler or the boat's crew. Not evidence: the points don't change.
  api.post('/catches/:id/photo', auth.requireUser, upload.single('photo'), (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user);
    if (!item) {
      discardUploads(req);
      return res.status(404).json({ error: 'Catch not found.' });
    }
    if (!item.canAddPhoto) {
      discardUploads(req);
      return res.status(403).json({ error: "Only the angler or the boat's crew can add its photo." });
    }
    if (!req.file) return res.status(400).json({ error: 'Choose a photo.' });
    const old = db.prepare('SELECT photo FROM catches WHERE id = ?').get(id).photo;
    db.prepare('UPDATE catches SET photo = ? WHERE id = ?').run(req.file.filename, id);
    removeUpload(old);
    res.json({ catch: getCatch(id, req.user) });
  });

  return { getCatch, postPhotos };
};
