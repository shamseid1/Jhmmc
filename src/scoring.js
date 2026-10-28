// JHMMC points for one catch, following the club rules for the season:
// - kept fish score their weight in kg times the species' points per kg;
// - a released marlin scores 500; a marlin under 100 kg that is kept scores minus 500, whatever it weighs;
// - a released sailfish scores as a 25 kg sailfish;
// - fish under 2 kg (ocean) or 1 kg (river) don't count.
// The secretary sees this as a suggestion and can change it when approving.

// Wrapped so the helpers stay private when the browser loads this file.
(function (root) {
  const RELEASED_MARLIN_POINTS = 500;
  const SMALL_MARLIN_KEPT_PENALTY = 500;
  const MARLIN_KEEP_LIMIT_KG = 100;
  const RELEASED_SAIL_KG = 25;
  const MIN_KG = { ocean: 2, river: 1 };

  const isMarlin = (species) => /marlin/i.test(species);
  const isSailfish = (species) => /sailfish/i.test(species);
  const round = (n) => Math.round(n * 10) / 10;

  function scoreCatch({ species, pointsPerKg, weightKg, released, division = 'ocean' }) {
    if (isMarlin(species) && released) {
      return { points: RELEASED_MARLIN_POINTS, note: `Released marlin: ${RELEASED_MARLIN_POINTS} points.` };
    }
    if (isSailfish(species) && released) {
      return { points: round(RELEASED_SAIL_KG * pointsPerKg), note: `Released sailfish, scored as a ${RELEASED_SAIL_KG} kg sail.` };
    }
    if (released) return { points: 0, note: 'Released without an official weight: no points.' };
    if (weightKg == null) return { points: 0, note: 'Waiting for the official weight.' };
    if (isMarlin(species) && weightKg < MARLIN_KEEP_LIMIT_KG) {
      return { points: -SMALL_MARLIN_KEPT_PENALTY, note: `Marlin under ${MARLIN_KEEP_LIMIT_KG} kg kept: minus ${SMALL_MARLIN_KEPT_PENALTY} points.` };
    }
    const min = MIN_KG[division] ?? MIN_KG.ocean;
    if (weightKg < min) return { points: 0, note: `Under ${min} kg (${division}): not counted.` };
    const points = round(weightKg * pointsPerKg);
    return { points, note: `${weightKg} kg × ${pointsPerKg} points per kg.` };
  }

  // The same rules run on the server and, for the live points on the
  // registration sheet, in the browser (served as /scoring.js).
  const api = { scoreCatch, MIN_KG };
  if (typeof module !== 'undefined') module.exports = api;
  else root.scoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
