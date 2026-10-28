// The JHMMC record book as kept by the club before the app: "JHMMC Records As
// at May 3, 2026" (public/records/JHMMC-records-2026-05-03.pdf). Copied as
// printed, with weights in kg and line classes in the app's spelling. Dates
// are ISO where the book gives a full date; `year` where it gives only a
// year; neither where it gives none. Two dates printed as spreadsheet numbers
// (43201, 45000) are 11 Apr 2018 and 15 Mar 2023.
// `species` names the app species each group matches, so approved
// registrations join its list.

const AS_AT = '2026-05-03';
const PDF = '/records/JHMMC-records-2026-05-03.pdf';

// [boat, angler, line class, kg, date ('YYYY-MM-DD', 'YYYY' or '')]
const BOOK = [
  ['Blue Marlin', 'Atlantic blue marlin', [
    ['Wahoo', 'Heinz Wachter', '80 lb', 430.6, '2009-12-06'],
    ['Swiss Lady', 'Oliver Takatsch', '80 lb', 429.5, '2000'],
    ['Sea Star', 'Guido Bucher', '50 lb', 365.6, '2012-03-04'],
    ['Liberian Girl', 'Rayan Eid', '100 lb', 325.2, '2022-12-04'],
    ['Liberian Girl', 'Feras Asmar', '130 lb', 321.0, '2024-12-08'],
    ['Yellow Fin', 'Jean Chahine', '50 lb', 298.0, '2000-02-22'],
    ['Lucky Manana', 'Raimon Pros', '80 lb', 297.0, '2009-12-20'],
    ['4-Play', 'Joe Barefoot', '80 lb', 294.0, '2012-04-07'],
    ['Liberian Girl', 'Rayan Eid', '80 lb', 290.0, '2024-02-18'],
    ['Sea Monkey', 'Dani Eid', '80 lb', 276.7, '2022-11-06'],
    ['Reel Magic', 'Ivan Muir', '80 lb', 270.6, '2013-11-17'],
  ]],
  ['Atlantic Sailfish', 'Atlantic sailfish', [
    ['Yellow Fin', 'Robert M. Khoueiry', '50 lb', 52.5, '2006-04-14'],
    ['Yellow Fin', 'Borje Thomsson', '80 lb', 48.5, ''],
    ['Reel Magic', 'Mario Ali', '80 lb', 47.6, '2014-11-02'],
    ['Liberian Girl', 'Khaled Hamadeh', '80 lb', 35.0, '2026-05-03'],
  ]],
  ['Wahoo', 'Wahoo', [
    ['Bottom Line', 'Robert Bains', '80 lb', 44.1, '2015-11-26'],
    ['Wahoo', 'Heinz Wachter', '80 lb', 32.0, ''],
    ['Lucky Manana', 'Jean Chahine', '50 lb', 28.9, '2013-01-15'],
  ]],
  ['Dolphin / Dorado', 'Dorado (mahi-mahi)', [
    ['Aquaholic', 'Vijay Parmar', '80 lb', 22.3, '2018-04-11'],
    ['Jenny Bee', 'Silvio Cantieni', '80 lb', 22.2, ''],
    ['Sea Star', 'Bryan Wilson', '20 lb', 21.0, '2013-12-21'],
  ]],
  ['Yellowfin Tuna', 'Yellowfin tuna', [
    ['Sea Monkey', 'Mazen Ayoub', '80 lb', 129.7, '2023-03-15'],
    ['Beluga Lee', 'David Spangenberg', '80 lb', 116.5, '2014-11-09'],
    ['Aquaholic', 'Steve Kissik', '80 lb', 112.6, '2023-10-30'],
    ['Bait Master', 'Jack Asmar', '80 lb', 112.3, '2020-12-06'],
    ['Bait Master', 'Jad Asmar', '80 lb', 112.2, '2024-04-21'],
    ['Reel Magic', 'Tim Mitchel', '80 lb', 111.0, '2015-01-01'],
    ['Liberian Girl', 'Rayan Eid', '80 lb', 111.3, '2022-12-25'],
    ['Lucky Manana', 'Robert M. Khoueiry', '80 lb', 110.4, '2016-03-13'],
  ]],
  ['Bonito', 'Atlantic bonito', [
    ['Reel Magic', 'Nader Ayoub', '50 lb', 7.8, '2015-11-08'],
    ['Bait Master', 'Jack Asmar', '50 lb', 6.6, '2014-11-23'],
    ['Aquaholic', 'Elie Daher', '50 lb', 6.0, '2011-12-20'],
  ]],
  ['Barracuda', 'Barracuda', [
    ['Eagle', 'Wajih Eid', '30 lb', 25.4, '2011-12-24'],
    ['King Fisher', 'Joseph Svedberg', '50 lb', 23.5, ''],
    ['Stratos', 'Sara Eid', '30 lb', 22.7, '2018-01-29'],
    ['Bait Master', 'Jack Asmar', '50 lb', 22.0, '2021-02-21'],
    ['Wave Runner', 'Dominic Asmar', '30 lb', 21.6, '2019-03-02'],
    ['Romeo', 'Richard Haikal', '30 lb', 20.1, '2024-03-13'],
    ['Wave Runner', 'Charbel Asmar', '30 lb', 18.28, '2026-02-15'],
  ]],
  ['Crevalle Jack', 'Crevalle jack', [
    ['White Rose', 'Alfons Blatty', '50 lb', 24.5, ''],
    ['Cavalla', 'Thomas Goh Yong Siah', '30 lb', 18.0, '2010-01-02'],
    ['Pro-Line', 'Samer Halabi', '30 lb', 15.8, '2011-11-27'],
  ]],
  ['Spanish Mackerel', 'West African Spanish mackerel', [
    ['Sea Star', 'Issam Makki', '30 lb', 4.5, '2014-03-23'],
    ['Acquaholic', 'Olga Daher', '30 lb', 3.33, '2010-11-21'],
    ['Challenger', 'Jan Suck', '30 lb', 3.0, '2023-12-25'],
    ['Sea Star', 'Guido Bucher', '50 lb', 2.8, '2012-04-01'],
  ]],
  ['Grouper', 'Dusky grouper', [
    ['Rescue', 'Bassil Makki', '30 lb', 19.5, '2023-01-15'],
    ['Rocket Launcher', 'Elie Daher', '50 lb', 19.3, '2016-02-25'],
    ['Romeo', 'Richard Haikal', '30 lb', 18.0, '2014-11-16'],
    ['Pro-Line', 'Mazen Halabi', '30 lb', 16.6, '2015-11-15'],
  ]],
  ['Shark / Mako', 'Shortfin mako shark', [
    ['Aquaholic', 'Elie Daher', '80 lb', 70.4, '2016-03-09'],
    ['Liberian Girl', 'Marwan Abdalkareem', '80 lb', 56.8, '2025-03-16'],
    ['Lucky Manana', 'Raimon Pros', '80 lb', 52.5, '2006-05-21'],
    ['Sea Star', 'Guido Bucher', '80 lb', 23.8, '2010-12-05'],
  ]],
  ['Striped Marlin', 'Striped marlin', [
    ['Aquaholic', 'Elie Daher', '80 lb', 45.0, '2011-11-06'],
    ['Knot e Bouy', 'Edwin Michael', '30 lb', 41.5, ''],
    ['Yellow Fin', 'Matthias Boeffgen', '50 lb', 39.5, '2006-11-19'],
  ]],
  ['Cobia', 'Cobia', [
    ['Wahoo', 'Silvio Cantieni', '12 lb', 11.0, ''],
    ['Sea Pro', 'Fadi Eid', '50 lb', 7.4, '2013-03-01'],
    ['Shams', 'Rachad Eid', '50 lb', 5.2, '2011-01-22'],
  ]],
  ['African Threadfin / Butter Nose', 'Giant African threadfin', [
    ['Romeo', 'Richard Haikal', '30 lb', 25.6, '2016-05-01'],
    ['Dont Play with Me', 'Farouk Eid', '30 lb', 24.0, ''],
    ['Stratos', 'Rasmi Eid', '30 lb', 8.8, '2014-01-25'],
  ]],
  ['Bigeye Trevally', 'Bigeye trevally', [
    ['Shams', 'Ayman Al-Ashkar', '50 lb', 1.2, '2011-12-11'],
    ['Sea Star', 'Robert Khoueiry', '80 lb', 1.2, '2011-10-16'],
  ]],
  ['Rainbow Runner', 'Rainbow runner', [
    ['Bottom Line', 'Robert Baines', '50 lb', 5.5, '2016-11-13'],
    ['Reel Magic', 'Mario Ali', '50 lb', 1.6, '2012-05-12'],
    ['Bottom Line', 'Robert Baines', '50 lb', 1.5, '2016-11-13'],
  ]],
  ['Almaco Jack', 'Almaco jack', [
    ['Reel Magic', 'Fadi Eid', '50 lb', 1.6, '2012-05-12'],
    ['Bait Master', 'Jack Asmar', '50 lb', 1.5, '2014-11-30'],
    ['Reel Magic', 'Roy Elia', '50 lb', 1.4, '2012-05-12'],
    ['Reel Magic', 'Mario Ali', '50 lb', 1.4, '2012-05-12'],
  ]],
  ['African Pompano', 'African pompano', [
    ['Jenny Bee', 'Walter Blaser', '50 lb', 7.4, ''],
    ['Tuna King', 'Elie Daher', '50 lb', 1.2, '2012-10-28'],
    ['Lucky Manana', 'Jan Suck', '50 lb', 1.2, '2015-11-15'],
  ]],
  ['Tripletail', 'Tripletail', [
    ['Tuna King', 'Elie Daher', '50 lb', 1.6, '2012-10-21'],
    ['Aquaholic', 'Elie Daher', '50 lb', 0.8, '2012-05-06'],
    ['Aquaholic', 'Elie Daher', '50 lb', 0.5, '2019-11-10'],
  ]],
  ['Tarpon', 'Atlantic tarpon', [
    ['Halahala', 'George Rizk', '30 lb', 40.1, '2018-03-26'],
    ['Sea Master', 'Joe Barefoot', '80 lb', 25.0, '2012-01-29'],
  ]],
  ['Red Snapper', 'Snapper', [
    ['Rescue', 'Guido Bucher', '16 lb', 28.5, '2022-04-08'],
    ['Swiss Lady', 'Oliver Takatsch', '30 lb', 6.7, ''],
  ]],
  ['Butter Nose', 'Butter nose', [
    ['Romeo', 'Jack Haikal', '30 lb', 7.2, '2026-02-08'],
    ['Wave Runner', 'Dominic Asmar', '30 lb', 3.7, '2023-12-17'],
  ]],
  ['Yellow Tail', 'Yellow tail', [['Shams', 'Rachad Eid', '50 lb', 0.6, '2011-01-22']]],
  ['Grunter', 'Grunter', [['Scandica', 'Agnetta Nilsson', '50 lb', 0.6, '2012-02-12']]],
  ['Spotted Grunter', 'Spotted grunter', [['Scandica', 'Agnetta Nilsson', '30 lb', 0.8, '2012-12-30']]],
  ['Tiger Fish', 'Tiger fish', [['Scandica', 'Agnetta Nilsson', '50 lb', 2.0, '2012-04-14']]],
  ['Sting Ray', 'Stingray', [['Wave Runner', 'Dominic Asmar', '30 lb', 2.1, '2019-12-01']]],
  ['Amberjack', 'Greater amberjack', [['Challenger', 'Jan Suck', '30 lb', 22.8, '2025-11-09']]],
];

const GROUPS = BOOK.map(([title, species, rows]) => ({
  title,
  species,
  records: rows.map(([boat, angler, lineClass, weightKg, date]) => ({
    boat, angler, lineClass, weightKg,
    caughtOn: date.length === 10 ? date : null,
    year: date.length === 4 ? date : null,
  })),
}));

module.exports = { AS_AT, PDF, GROUPS };
