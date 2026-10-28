// IGFA all-tackle world records for the species in the app, keyed by the
// species name in db.js. Compiled from published IGFA-approved records as
// reported in October 2026; the IGFA database is the authority and the app
// links to it. Species without a confirmed current record are left out and
// shown with a link to the IGFA search instead.
const CHECKED = '2026-10';
const IGFA_SEARCH_URL = 'https://igfa.org/world-records/';

const RECORDS = {
  'Atlantic blue marlin': { lb: 1402, oz: 2, angler: 'Paulo Amorim', place: 'Vitória, Brazil', date: '1992-02-29' },
  'Atlantic sailfish': { lb: 142, oz: 6, angler: 'Marco Couto', place: 'Lobito, Angola', date: '2014' },
  'White marlin': { lb: 181, oz: 14, angler: 'Evandro Luiz Coser', place: 'Vitória, Brazil', date: '1979-12-08' },
  'Swordfish': { lb: 1182, oz: 0, angler: 'Louis Marron', place: 'Iquique, Chile', date: '1953-05-07' },
  'Yellowfin tuna': { lb: 427, oz: 0, angler: 'Guy Yocom', place: 'Cabo San Lucas, Mexico', date: '2012-09-18' },
  'Bigeye tuna': { lb: 392, oz: 6, angler: 'Dieter Vogel', place: 'Gran Canaria, Spain', date: '1996-07-25', note: 'Atlantic bigeye' },
  'Skipjack tuna': { lb: 46, oz: 5, angler: 'Joeri Van Laken', place: 'La Gomera, Spain', date: '2020-11-15' },
  'Wahoo': { lb: 184, oz: 0, angler: 'Sara Hayward', place: 'Cabo San Lucas, Mexico', date: '2005' },
  'Dorado (mahi-mahi)': { lb: 87, oz: 0, angler: 'Manuel Salazar', place: 'Papagayo, Costa Rica', date: '1976' },
  'Guinean barracuda': { lb: 102, oz: 0, angler: 'Thomas Gibson', place: 'Barra do Kwanza, Angola', date: '2013' },
  'Crevalle jack': { lb: 66, oz: 2, angler: 'Carlos Alberto Leal Simões', place: 'Barra do Dande, Angola', date: '2010' },
  'African pompano': { lb: 50, oz: 8, angler: 'Tom Sargent', place: 'Daytona Beach, USA', date: '1990-04-21' },
  'Cubera snapper': { lb: 124, oz: 12, angler: 'Marion Rose', place: 'Garden Banks, Louisiana, USA', date: '2007-06-23' },
  'Atlantic tarpon': { lb: 286, oz: 9, angler: 'Max Domecq', place: 'Rubane, Guinea-Bissau', date: '2003-03-20' },
  'Shortfin mako shark': { lb: 1221, oz: 0, angler: 'Luke Sweeney', place: 'Chatham, Massachusetts, USA', date: '2001-07-21' },
  'Hammerhead shark': { lb: 1280, oz: 0, angler: 'Bucky Dennis', place: 'Boca Grande, Florida, USA', date: '2006-05-23', note: 'Great hammerhead' },
};

// Where the record fish was caught, to flag African records.
const AFRICAN = ['Angola', 'Guinea-Bissau'];

function igfaRecord(species) {
  const r = RECORDS[species];
  if (!r) return null;
  const totalLb = r.lb + r.oz / 16;
  return {
    ...r,
    kg: Math.round(totalLb * 0.45359237 * 10) / 10,
    display: `${r.lb.toLocaleString('en-US')} lb${r.oz ? ` ${r.oz} oz` : ''}`,
    african: AFRICAN.some((c) => r.place.endsWith(c)),
  };
}

module.exports = { igfaRecord, CHECKED, IGFA_SEARCH_URL };
