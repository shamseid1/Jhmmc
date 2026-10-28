// JHMMC points for one catch, following the club rules for the season:
// - only Sundays, public holidays and tournament days score;
// - kept fish score their weight in kg times the species' points per kg;
// - a released marlin scores 500; a marlin under 100 kg that is kept loses its points;
// - a released sailfish scores as a 25 kg sailfish;
// - fish under 2 kg (ocean) or 1 kg (river) don't count.
// The secretary sees this as a suggestion and can change it when approving.

const RELEASED_MARLIN_POINTS = 500;
const MARLIN_KEEP_LIMIT_KG = 100;
const RELEASED_SAIL_KG = 25;
const MIN_KG = { ocean: 2, river: 1 };

const isMarlin = (species) => /marlin/i.test(species);
const isSailfish = (species) => /sailfish/i.test(species);
const round = (n) => Math.round(n * 10) / 10;

function isSunday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
}

function scoreCatch({ species, pointsPerKg, weightKg, released, division = 'ocean', scoringDay }) {
  if (!scoringDay) return { points: 0, note: 'Not a scoring day: only Sundays, holidays and tournaments count.' };
  if (isMarlin(species) && released) {
    return { points: RELEASED_MARLIN_POINTS, note: `Released marlin: ${RELEASED_MARLIN_POINTS} points.` };
  }
  if (isSailfish(species) && released) {
    return { points: round(RELEASED_SAIL_KG * pointsPerKg), note: `Released sailfish, scored as a ${RELEASED_SAIL_KG} kg sail.` };
  }
  if (released) return { points: 0, note: 'Released without an official weight: no points.' };
  if (weightKg == null) return { points: 0, note: 'Waiting for the official weight.' };
  const min = MIN_KG[division] ?? MIN_KG.ocean;
  if (weightKg < min) return { points: 0, note: `Under ${min} kg (${division}): not counted.` };
  const points = round(weightKg * pointsPerKg);
  if (isMarlin(species) && weightKg < MARLIN_KEEP_LIMIT_KG) {
    return { points: -points, note: `Marlin under ${MARLIN_KEEP_LIMIT_KG} kg kept: its ${points} points are deducted.` };
  }
  return { points, note: `${weightKg} kg × ${pointsPerKg} points per kg.` };
}

module.exports = { scoreCatch, isSunday, MIN_KG };
