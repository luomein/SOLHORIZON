const radians = Math.PI / 180;
const radius = 6371008.8;
const resolution = 1440;
const originUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const tiles = new Map();

function pixel(lat, lon, zoom) {
  const size = 256 * 2 ** zoom;
  const mercator = Math.asinh(Math.tan(Math.max(-85, Math.min(85, lat)) * radians));
  return [Math.floor((lon / 360 + 0.5) * size), Math.floor((0.5 - mercator / (2 * Math.PI)) * size)];
}

function tileKey(x, y, zoom) {
  const size = 2 ** zoom;
  return [zoom, ((x >> 8) % size + size) % size, y >> 8].join('/');
}

async function decode(key) {
  const response = await fetch(originUrl + '/' + key + '.png');
  if (!response.ok) throw new Error('Elevation tile unavailable');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, 256, 256).data;
}

function tile(key) {
  if (!tiles.has(key)) {
    const request = decode(key).catch(() => {
      tiles.delete(key);
      return null;
    });
    tiles.set(key, request);
    if (tiles.size > 260) tiles.delete(tiles.keys().next().value);
  }
  return tiles.get(key);
}

function heightAt(data, x, y) {
  if (!data) return null;
  const i = ((y & 255) * 256 + (x & 255)) * 4;
  return Math.max(0, data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768);
}

export async function terrain(lat, lon, eye) {
  const groups = new Map();
  function sample(latitude, longitude, zoom, distance, ray) {
    const [x, y] = pixel(latitude, longitude, zoom);
    const key = tileKey(x, y, zoom);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ x, y, distance, ray });
  }
  sample(lat, lon, 13, 0, -1);
  const sinLat = Math.sin(lat * radians);
  const cosLat = Math.cos(lat * radians);
  for (let distance = 35; distance <= 110000; distance *= 1.064) {
    const zoom = distance < 7500 ? 13 : distance < 27000 ? 11 : 9;
    const arc = distance / radius;
    const sinArc = Math.sin(arc);
    const cosArc = Math.cos(arc);
    for (let ray = 0; ray < resolution; ray++) {
      const az = 2 * Math.PI * ray / resolution;
      const nextLat = Math.asin(sinLat * cosArc + cosLat * sinArc * Math.cos(az));
      const nextLon = lon + Math.atan2(Math.sin(az) * sinArc * cosLat, cosArc - sinLat * Math.sin(nextLat)) / radians;
      sample(nextLat / radians, nextLon, zoom, distance, ray);
    }
  }

  const entries = [...groups];
  const data = new Map();
  let index = 0;
  await Promise.all(Array.from({length: 10}, async () => {
    while (index < entries.length) {
      const [key] = entries[index++];
      data.set(key, await tile(key));
    }
  }));

  const first = entries[0][1][0];
  const base = heightAt(data.get(entries[0][0]), first.x, first.y);
  const observer = (base ?? 0) + eye;
  const sea = -Math.sqrt(2 * observer / radius) / radians;
  const layers = Array.from({length: 3}, () => new Float32Array(resolution).fill(sea));
  for (const [key, points] of entries) {
    const raster = data.get(key);
    if (!raster) continue;
    for (const {x, y, distance, ray} of points) {
      if (ray < 0) continue;
      const ground = heightAt(raster, x, y);
      if (ground === 0) continue;
      const curvature = distance ** 2 / (2 * radius);
      const angle = Math.atan2(ground - observer - curvature, distance) / radians;
      const layer = distance < 4500 ? 2 : distance < 24000 ? 1 : 0;
      layers[layer][ray] = Math.max(layers[layer][ray], angle);
    }
  }
  const missing = [...data.values()].filter(value => !value).length;
  return {layers, sea, observer, base, missing, count: data.size};
}

export function skyline(model, azimuth) {
  if (!model) return 0;
  const i = ((azimuth % 360 + 360) % 360) * resolution / 360;
  const a = Math.floor(i);
  const b = (a + 1) % resolution;
  return Math.max(model.sea, ...model.layers.map(layer => layer[a] + (layer[b] - layer[a]) * (i - a)));
}
