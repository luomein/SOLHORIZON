const rad = Math.PI / 180;
export const day = 86400000;
export const wrap = angle => (angle % 360 + 360) % 360;
export const difference = (angle, center) => wrap(angle - center + 180) - 180;

export function bearing(lat, lon, targetLat, targetLon) {
  const a = lat * rad;
  const b = targetLat * rad;
  const delta = (targetLon - lon) * rad;
  return wrap(Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / rad);
}

const earthRadiusKm = 6371;

export function distanceKm(lat, lon, targetLat, targetLon) {
  const a = lat * rad;
  const b = targetLat * rad;
  const haversine = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) *
    Math.sin(difference(targetLon, lon) * rad / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function destination(lat, lon, angle, distance) {
  const latitude = lat * rad;
  const arc = distance / earthRadiusKm;
  const azimuth = angle * rad;
  const end = Math.asin(Math.sin(latitude) * Math.cos(arc) + Math.cos(latitude) * Math.sin(arc) * Math.cos(azimuth));
  const offset = Math.atan2(Math.sin(azimuth) * Math.sin(arc) * Math.cos(latitude), Math.cos(arc) - Math.sin(latitude) * Math.sin(end));
  return [end / rad, difference(lon + offset / rad, 0)];
}

export function sun(time, latitude, longitude) {
  const days = time / day - 10957.5;
  const anomaly = rad * (357.5291 + 0.98560028 * days);
  const ecliptic = anomaly + rad * (282.9372 + 1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  const tilt = 23.4397 * rad;
  const declination = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
  const ascension = Math.atan2(Math.sin(ecliptic) * Math.cos(tilt), Math.cos(ecliptic));
  const hour = (280.16 + 360.9856235 * days + longitude) * rad - ascension;
  return horizontal(hour, declination, latitude);
}

export function horizontal(hour, declination, latitude) {
  const lat = latitude * rad;
  const altitude = Math.asin(Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hour)) / rad;
  const azimuth = wrap(180 + Math.atan2(Math.sin(hour), Math.cos(hour) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat)) / rad);
  return { altitude, azimuth };
}

export function events(date, lat, lon, horizon, eventTypes, locate = sun) {
  // Search from local mean solar midnight, regardless of the viewer's time zone.
  const start = date - lon / 360 * day;
  const step = day / 288;
  function evaluate(time) {
    const position = locate(time, lat, lon);
    const edgeAltitude = position.altitude + (position.radius ?? 0.2667) + 0.5667 * Math.exp(-Math.max(0, position.altitude) / 6);
    const altitude = horizon(position.azimuth);
    return {...position, altitude, clearance: edgeAltitude - altitude};
  }
  const result = {};
  let previous = evaluate(start);
  for (let i = 1; i <= 288; i++) {
    const time = start + i * step;
    const next = evaluate(time);
    const type = previous.clearance <= 0 && next.clearance > 0 ? 'rise' :
      previous.clearance > 0 && next.clearance <= 0 ? 'set' : null;
    if (type && eventTypes.includes(type) && (type === 'set' || !result.rise)) {
      let lower = time - step;
      let upper = time;
      for (let j = 0; j < 15; j++) {
        const mid = (lower + upper) / 2;
        if ((evaluate(mid).clearance > 0) === (type === 'rise')) upper = mid;
        else lower = mid;
      }
      const eventTime = (lower + upper) / 2;
      result[type] = {...evaluate(eventTime), date, time: eventTime, type};
    }
    previous = next;
  }
  return Object.values(result);
}
