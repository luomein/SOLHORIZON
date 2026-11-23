const names = new Map();
let queue = Promise.resolve();

async function wikipediaName(lat, lon, radius) {
  const language = navigator.language.startsWith('zh') || (lat >= 21.5 && lat <= 26 && lon >= 118 && lon <= 123) ? 'zh' : 'en';
  const query = new URLSearchParams({
    action:'query', list:'geosearch', gscoord:lat + '|' + lon, gsradius:String(radius),
    gslimit:'5', format:'json', origin:'*'
  });
  const result = await fetch('https://' + language + '.wikipedia.org/w/api.php?' + query, {
    signal:AbortSignal.timeout(6500)
  });
  if (!result.ok) return '';
  const {query:data} = await result.json();
  return data?.geosearch?.[0]?.title ?? '';
}

async function openStreetMapName(lat, lon, radius) {
  const query = new URLSearchParams({data:'[out:json][timeout:5];node(around:' + radius + ',' + lat + ',' + lon + ')["name"];out 30;'});
  const result = await fetch('https://overpass-api.de/api/interpreter?' + query, {signal:AbortSignal.timeout(6500)});
  if (!result.ok) return '';
  const {elements} = await result.json();
  const origin = window.L.latLng(lat, lon);
  const nearest = elements?.sort((a,b) => origin.distanceTo([a.lat,a.lon]) - origin.distanceTo([b.lat,b.lon]))[0];
  return nearest?.tags?.['name:zh'] ?? nearest?.tags?.name ?? '';
}

export function placeName(lat, lon, radius) {
  const key = [lat, lon, radius].join('/');
  if (names.has(key)) return names.get(key);
  const request = queue.then(async () => {
    const name = await wikipediaName(lat, lon, radius).catch(() => '') ||
      await openStreetMapName(lat, lon, radius).catch(() => '');
    return typeof name === 'string' ? name.trim().slice(0,100) : '';
  });
  names.set(key, request);
  queue = request.catch(() => '');
  return request;
}
