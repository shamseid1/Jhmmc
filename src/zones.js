// Each country's clock, so "today" for a boat is its own day: a fish at 00:30 in
// Lagos belongs to that day, not to yesterday on Monrovia's clock. West Africa
// has no summer time, so these never shift. JHMMC's own dates (the season, its
// tournaments) stay on Monrovia's clock.
const ZONES = {
  Benin: 'Africa/Porto-Novo',
  'Burkina Faso': 'Africa/Ouagadougou',
  'Cabo Verde': 'Atlantic/Cape_Verde',
  Cameroon: 'Africa/Douala',
  "Côte d'Ivoire": 'Africa/Abidjan',
  'Equatorial Guinea': 'Africa/Malabo',
  Gabon: 'Africa/Libreville',
  'The Gambia': 'Africa/Banjul',
  Ghana: 'Africa/Accra',
  Guinea: 'Africa/Conakry',
  'Guinea-Bissau': 'Africa/Bissau',
  Liberia: 'Africa/Monrovia',
  Mali: 'Africa/Bamako',
  Mauritania: 'Africa/Nouakchott',
  Niger: 'Africa/Niamey',
  Nigeria: 'Africa/Lagos',
  'São Tomé and Príncipe': 'Africa/Sao_Tome',
  Senegal: 'Africa/Dakar',
  'Sierra Leone': 'Africa/Freetown',
  Togo: 'Africa/Lome',
};
const CLUB_ZONE = 'Africa/Monrovia';
const zoneOf = (country) => ZONES[country] || CLUB_ZONE;
// The date (YYYY-MM-DD) on that clock, now or at a given moment.
const dateIn = (zone, at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(at instanceof Date ? at : new Date(at));

module.exports = { ZONES, CLUB_ZONE, zoneOf, dateIn };
