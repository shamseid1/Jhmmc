const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreCatch } = require('../src/scoring');

const day = {};

test('JHMMC points per catch', () => {
  assert.equal(scoreCatch({ species: 'Wahoo', pointsPerKg: 5, weightKg: 20, ...day }).points, 100, 'any day scores');
  assert.equal(scoreCatch({ species: 'Barracuda', pointsPerKg: 3, weightKg: 7.5, ...day }).points, 22.5);
  assert.equal(scoreCatch({ species: 'Atlantic blue marlin', pointsPerKg: 5, released: true, ...day }).points, 500);
  assert.equal(scoreCatch({ species: 'Atlantic blue marlin', pointsPerKg: 5, weightKg: 80, ...day }).points, -500, 'small marlin kept');
  assert.equal(scoreCatch({ species: 'White marlin', pointsPerKg: 5, weightKg: 30, ...day }).points, -500, 'any small marlin kept is minus 500');
  assert.equal(scoreCatch({ species: 'Atlantic blue marlin', pointsPerKg: 5, weightKg: 180, ...day }).points, 900);
  assert.equal(scoreCatch({ species: 'Atlantic sailfish', pointsPerKg: 5, released: true, ...day }).points, 125, 'released sail = 25 kg');
  assert.equal(scoreCatch({ species: 'Atlantic sailfish', pointsPerKg: 5, weightKg: 30, ...day }).points, 150, 'kept sail: no penalty');
  assert.equal(scoreCatch({ species: 'Snapper', pointsPerKg: 5, weightKg: 1.5, division: 'ocean', ...day }).points, 0, 'under 2 kg ocean');
  assert.equal(scoreCatch({ species: 'Snapper', pointsPerKg: 5, weightKg: 1.5, division: 'river', ...day }).points, 7.5, 'river minimum is 1 kg');
  assert.equal(scoreCatch({ species: 'Wahoo', pointsPerKg: 5, released: true, ...day }).points, 0, 'released, not weighed');
});
