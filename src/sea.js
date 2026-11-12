'use strict';

// Sea conditions: weather and marine forecasts from Open-Meteo (free, no key, worldwide:
// wind, waves, swell, sea temperature, currents, sea level with the tide), turned into what
// an angler wants to know; the sun and moon worked out here. Places are rounded to 0.1° (about
// 11 km) before asking, so an exact spot never leaves the server, and answers are kept a while.

const KN_PER_KMH = 1 / 1.852;
const round1 = (n) => Math.round(n * 10) / 10;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => (deg == null ? null : COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]);

// A day for fishing, from the wind and the waves.
function rating(windKn, waveM) {
  if (windKn == null && waveM == null) return null;
  if ((windKn ?? 0) >= 18 || (waveM ?? 0) >= 2.2) return 'rough';
  if ((windKn ?? 0) < 12 && (waveM ?? 0) < 1.5) return 'good';
  return 'fair';
}

// The moon: its age in days (0 = new), how lit it is, and its phase's name.
const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
function moon(at = new Date()) {
  const age = ((((at.getTime() - NEW_MOON) / 864e5) % SYNODIC) + SYNODIC) % SYNODIC;
  const lit = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100);
  const name = age < 1.85 ? 'New moon' : age < 5.54 ? 'Waxing crescent' : age < 9.23 ? 'First quarter' : age < 12.92 ? 'Waxing gibbous'
    : age < 16.61 ? 'Full moon' : age < 20.3 ? 'Waning gibbous' : age < 23.99 ? 'Last quarter' : age < 27.68 ? 'Waning crescent' : 'New moon';
  return { age: round1(age), lit, name };
}

// Best fishing times (solunar): the moon overhead and underfoot (major, two hours) and its
// rise and set (minor, an hour). The moon crosses the sky about 50 minutes later each day,
// overhead with the sun at new moon: close enough for a fishing table.
function solunar(solarNoonMin, moonAge) {
  const transit = solarNoonMin + (moonAge / SYNODIC) * 1440;
  const wrap = (m) => ((Math.round(m) % 1440) + 1440) % 1440;
  const span = (mid, half) => ({ from: wrap(mid - half), to: wrap(mid + half) });
  return {
    major: [span(transit, 60), span(transit + 745, 60)].sort((a, b) => a.from - b.from),
    minor: [span(transit - 372, 30), span(transit + 372, 30)].sort((a, b) => a.from - b.from),
  };
}

// Highs and lows of the tide from the hourly sea level: each turning point, its time made
// finer by fitting a curve through the three hours around it.
function tideTurns(times, levels) {
  const out = [];
  for (let i = 1; i < levels.length - 1; i++) {
    const [a, b, c] = [levels[i - 1], levels[i], levels[i + 1]];
    if (a == null || b == null || c == null) continue;
    const high = b > a && b >= c;
    const low = b < a && b <= c;
    if (!high && !low) continue;
    const denom = a - 2 * b + c;
    const shift = denom ? (0.5 * (a - c)) / denom : 0;
    const level = b - 0.25 * (a - c) * shift;
    const t = new Date(Date.parse(`${times[i]}:00Z`) + shift * 3600e3).toISOString().slice(0, 16);
    out.push({ type: high ? 'high' : 'low', time: t, level: Math.round(level * 100) / 100 });
  }
  return out;
}

const indexOfHour = (times, isoLocal) => times.indexOf(`${isoLocal.slice(0, 13)}:00`);
const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

// The conditions at one hour (local time "YYYY-MM-DDTHH:MM"): what's saved with a logged fish.
function conditionsAt(w, m, isoLocal) {
  const i = indexOfHour(w.hourly.time, isoLocal);
  const j = indexOfHour(m.hourly.time, isoLocal);
  if (i < 0 && j < 0) return null;
  const sl = m.hourly.sea_level_height_msl || [];
  const tide = j > 0 && sl[j] != null && sl[j - 1] != null ? (sl[j] > sl[j - 1] ? 'rising' : 'falling') : null;
  const at = new Date(Date.parse(`${isoLocal.slice(0, 16)}:00Z`) - (w.utc_offset_seconds || 0) * 1000);
  return {
    windKn: i >= 0 ? round1(w.hourly.wind_speed_10m[i]) : null,
    windDir: i >= 0 ? compass(w.hourly.wind_direction_10m[i]) : null,
    waveM: j >= 0 ? round1(m.hourly.wave_height[j]) : null,
    waterC: j >= 0 ? round1(m.hourly.sea_surface_temperature[j]) : null,
    tide,
    moon: moon(at).lit,
  };
}

// Everything for the Sea conditions page, from the two forecasts.
function summarize(w, m, now = new Date()) {
  const local = new Date(now.getTime() + (w.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 16);
  const today = local.slice(0, 10);
  const cur = w.current || {};
  const mc = m.current || {};
  const mo = moon(now);
  const d = w.daily;
  const sunrise = d.sunrise?.[0];
  const sunset = d.sunset?.[0];
  const minutes = (iso) => (iso ? Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) : null);
  const noon = sunrise && sunset ? (minutes(sunrise) + minutes(sunset)) / 2 : 720;
  const sstByDay = (day) => avg(m.hourly.time.map((t, k) => (t.startsWith(day) ? m.hourly.sea_surface_temperature[k] : null)));
  const days = d.time.map((day, k) => {
    const windKn = d.wind_speed_10m_max?.[k] ?? null;
    const waveM = m.daily?.wave_height_max?.[k] ?? null;
    return {
      date: day, windKn: windKn == null ? null : Math.round(windKn), windDir: compass(d.wind_direction_10m_dominant?.[k]),
      waveM: waveM == null ? null : round1(waveM), waterC: (() => { const s = sstByDay(day); return s == null ? null : round1(s); })(),
      rating: rating(windKn, waveM),
    };
  });
  const sl = m.hourly.sea_level_height_msl || [];
  const turns = tideTurns(m.hourly.time, sl).filter((t) => t.time.startsWith(today));
  const tideCurve = m.hourly.time.map((t, k) => (t.startsWith(today) ? [Number(t.slice(11, 13)), sl[k]] : null)).filter((x) => x && x[1] != null);
  const nowWind = cur.wind_speed_10m ?? null;
  const nowWave = mc.wave_height ?? null;
  return {
    timeZone: w.timezone, localTime: local,
    now: {
      windKn: nowWind == null ? null : Math.round(nowWind), gustKn: cur.wind_gusts_10m == null ? null : Math.round(cur.wind_gusts_10m),
      windDir: compass(cur.wind_direction_10m), airC: cur.temperature_2m == null ? null : Math.round(cur.temperature_2m),
      waveM: nowWave == null ? null : round1(nowWave), swellM: mc.swell_wave_height == null ? null : round1(mc.swell_wave_height),
      swellS: mc.swell_wave_period == null ? null : Math.round(mc.swell_wave_period), swellDir: compass(mc.swell_wave_direction),
      waterC: mc.sea_surface_temperature == null ? null : round1(mc.sea_surface_temperature),
      currentKn: mc.ocean_current_velocity == null ? null : round1(mc.ocean_current_velocity * KN_PER_KMH),
      currentDir: compass(mc.ocean_current_direction),
      tide: conditionsAt(w, m, local)?.tide ?? null,
      rating: rating(nowWind, nowWave),
    },
    sun: { rise: sunrise?.slice(11, 16) ?? null, set: sunset?.slice(11, 16) ?? null },
    moon: mo,
    solunar: solunar(noon, mo.age),
    tide: { turns, curve: tideCurve },
    days,
  };
}

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const query = (lat, lng) => `latitude=${lat}&longitude=${lng}&timezone=auto&forecast_days=7&past_days=2`;

function createSea({ fetchImpl = globalThis.fetch, ttlMs = 30 * 60e3 } = {}) {
  const cache = new Map();
  async function get(json) {
    const res = await fetchImpl(json, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Forecast ${res.status}`);
    return res.json();
  }
  // Both forecasts for a place (rounded), kept for half an hour.
  async function forecasts(latIn, lngIn) {
    const lat = round1(latIn);
    const lng = round1(lngIn);
    const key = `${lat},${lng}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    const [w, m] = await Promise.all([
      get(`${FORECAST}?${query(lat, lng)}&wind_speed_unit=kn&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m`
        + '&hourly=wind_speed_10m,wind_direction_10m&daily=sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant'),
      get(`${MARINE}?${query(lat, lng)}&cell_selection=sea&current=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature,ocean_current_velocity,ocean_current_direction`
        + '&hourly=wave_height,sea_surface_temperature,sea_level_height_msl&daily=wave_height_max'),
    ]);
    const data = { w, m };
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), data });
    return data;
  }
  return {
    async summary(lat, lng) {
      const { w, m } = await forecasts(lat, lng);
      return summarize(w, m);
    },
    // The conditions when a fish was landed (it may be sent hours later, back in range).
    async at(lat, lng, when) {
      const { w, m } = await forecasts(lat, lng);
      const local = new Date(new Date(when).getTime() + (w.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 16);
      return conditionsAt(w, m, local);
    },
  };
}

module.exports = { createSea, summarize, conditionsAt, tideTurns, moon, solunar, rating, compass };
