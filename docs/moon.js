import {day, difference, events, horizontal} from './solar.js?v=moon';

const radians = Math.PI / 180;
const moonRadiusAu = 1737.4 / 149597870.7;

export function lunarEvents(date, latitude, longitude, height, horizon) {
  const astronomy = globalThis.Astronomy;
  const observer = new astronomy.Observer(latitude, longitude, height);
  const utcStart = date - longitude / 360 * day;
  const start = utcStart / day - 10957.5;
  const sidereal = astronomy.SiderealTime(start) * 15;
  const interval = 1 / 12;
  const samples = new Map();

  function equator(index) {
    if (!samples.has(index)) {
      samples.set(index, astronomy.Equator(astronomy.Body.Moon, start + index * interval, observer, true, true));
    }
    return samples.get(index);
  }

  function locate(time) {
    // Interpolate topocentric coordinates sampled every two hours. The observer's
    // distance from the Moon sets its apparent radius for the horizon crossing.
    const elapsed = (time - utcStart) / day;
    const nearest = Math.round(elapsed / interval);
    const fraction = elapsed / interval - nearest;
    const left = equator(nearest - 1);
    const center = equator(nearest);
    const right = equator(nearest + 1);
    const interpolate = (a, b) => fraction * ((b - a) + fraction * (a + b)) / 2;
    const ra = center.ra * 15 + interpolate(difference(left.ra * 15, center.ra * 15), difference(right.ra * 15, center.ra * 15));
    const dec = center.dec + interpolate(left.dec - center.dec, right.dec - center.dec);
    const distance = center.dist + interpolate(left.dist - center.dist, right.dist - center.dist);
    const hour = (sidereal + 360.98564736629 * elapsed + longitude - ra) * radians;
    return {...horizontal(hour, dec * radians, latitude), radius:Math.asin(moonRadiusAu / distance) / radians};
  }

  return events(date, latitude, longitude, horizon, ['rise','set'], locate)
    .map(event => ({...event, type:'moon' + event.type}));
}

const phaseNames = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'
];
const phases = new WeakMap();

export function lunarPhase(event) {
  if (!phases.has(event)) {
    const astronomy = globalThis.Astronomy;
    const time = new Date(event.time);
    const angle = astronomy.MoonPhase(time);
    const {phase_fraction: illuminated} = astronomy.Illumination(astronomy.Body.Moon, time);
    phases.set(event, {
      name:phaseNames[Math.round(angle / 45) % phaseNames.length],
      illuminated,
      waxing:angle < 180
    });
  }
  return phases.get(event);
}
