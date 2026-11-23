import {setupViewpointUnits} from './viewpoint-units.js';
import {defaultConfiguration} from './default-configuration.js?v=updated-default';
import {terrain, skyline} from './terrain.js?v=terrain-height';
import {drawPlacePin, setupPanoramaMap} from './panorama-map.js?v=clean-panorama';
import {day, wrap, difference, bearing, distanceKm, destination, events} from './solar.js?v=map-target-fields';
import {lunarEvents, lunarPhase} from './moon.js?v=phases';
import {mergePins, readStoredPins, setupSnapshots, writeStoredPins} from './snapshots.js?v=merge-pins';
import {setupDateRuler} from './date-ruler.js?v=vertical';

const $ = id => document.getElementById(id);
const viewpointUnits = setupViewpointUnits();
const island = [24.8455, 121.9524];
const places = [
  {name:'Wushih Harbor', local:'烏石港', lat:24.8702, lon:121.8399, aim:'island', view:107},
  {name:'Waiao Beach', local:'外澳沙灘', lat:24.8814, lon:121.8471, aim:'island', view:112},
  {name:'Xiangshan', local:'象山', lat:25.0273, lon:121.5705, aim:'bearing', view:267},
  {name:'Custom coordinates', local:'', aim:'bearing', view:90}
];
const labels = {rise:'Sunrise', set:'Sunset', moonrise:'Moonrise', moonset:'Moonset'};
const bearingRows = Object.fromEntries(Object.keys(labels).map(type => {
  const row = document.querySelector('.bearing-row.' + type);
  return [type, {
    output: row.querySelector('output'),
    track: row.querySelector('button'),
    bars: [...row.querySelectorAll('.range-bar')],
    dot: row.querySelector('.range-dot')
  }];
}));
const canvas = $('panorama');
const ctx = canvas.getContext('2d');
const markers = Object.fromEntries([...Object.keys(labels), 'target'].map(type => {
  const style = getComputedStyle(document.querySelector('.' + type));
  return [type, {
    fill: style.getPropertyValue('--marker-fill').trim(),
    outline: style.getPropertyValue('--marker-outline').trim(),
    radius: parseFloat(style.getPropertyValue('--marker-diameter')) / 2,
    stroke: parseFloat(style.getPropertyValue('--marker-stroke'))
  }];
}));

const moonMarkerRadius = 9;
const sunMarkerRadius = 10;

function drawMarker(type, x, y, radius = markers[type].radius) {
  const marker = markers[type];
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = marker.fill;
  ctx.fill();
  ctx.strokeStyle = marker.outline;
  ctx.lineWidth = marker.stroke;
  ctx.stroke();
}
function drawMoonMarker(event, x, y) {
  const {illuminated, waxing} = lunarPhase(event);
  const marker = markers[event.type];
  const radius = moonMarkerRadius;
  ctx.save();
  ctx.translate(x, y);
  if (!waxing) ctx.scale(-1, 1);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, 2 * Math.PI);
  ctx.fillStyle = '#27333e';
  ctx.fill();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
  // The returning half-ellipse crosses the disk center at quarter phases.
  const terminator = (1 - 2 * illuminated) * radius;
  if (Math.abs(terminator) > 0.01) {
    ctx.ellipse(0, 0, Math.abs(terminator), radius, 0, Math.PI / 2, 3 * Math.PI / 2, terminator > 0);
  }
  ctx.closePath();
  ctx.fillStyle = marker.fill;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = marker.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

const dateFormat = new Intl.DateTimeFormat('en', {dateStyle:'medium', timeZone:'UTC'});
const dateValue = time => new Date(time).toISOString().slice(0,10);
const parse = input => Date.parse(input.value + 'T00:00:00Z');
const formatDegree = n => n.toFixed(1) + '°';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
let position, target, model, best, drag, metrics, eventClock;
let heading, span, series = [], eventSectors = [], revision = 0;
const solarTypes = ['rise', 'set'];
let preview = null;
let closestByType = {};
let pins = [];
const panoramaMap = setupPanoramaMap({
  turnTo: angle => { heading = wrap(angle); draw(); },
  moveViewpoint: ([lat, lon]) => {
    applyCoordinates(lat, lon, true);
    centerOnTarget();
  },
  moveTarget: coordinates => aimAtCoordinates(coordinates, 'Map target'),
  changePins: next => {
    pins = next;
    persistPins();
    draw();
  },
  resetView: ([lat, lon], coordinates) => {
    const place = places.find(item => item.lat === lat && item.lon === lon) ?? places.at(-1);
    span = 90;
    setPosition({...place, lat, lon, view:90}, false, {value:90, name:'Map target', coordinates});
  },
  markers
});
const cache = new Map();

function centerOnTarget() {
  heading = target.value;
  draw();
}

function setTarget(value, name = 'Selected bearing', coordinates = null) {
  target = {value:wrap(value), name, coordinates};
  const angle = $('targetAngle');
  angle.value = angle.defaultValue = String(Number(target.value.toFixed(3)));
  viewpointUnits.setDistance(coordinates ? distanceKm(position.lat, position.lon, ...coordinates) : null);
  updateMatch();
  draw();
}
function aimAtCoordinates(coordinates, name, center = true) {
  const direction = bearing(position.lat, position.lon, ...coordinates);
  if (center) heading = direction;
  setTarget(direction, name, coordinates);
}
function aimIsland() {
  aimAtCoordinates(island, '龜山島');
}
function updateMatch() {
  best = null;
  closestByType = {};
  const delta = point => Math.abs(difference(point.azimuth, target.value));
  for (const point of series) {
    const closest = closestByType[point.type];
    if (!closest || delta(point) < delta(closest)) closestByType[point.type] = point;
    if (!best || delta(point) < delta(best)) best = point;
  }
}

function refresh() {
  const start = parse($('start'));
  const end = parse($('end'));
  const count = Math.round((end - start) / day) + 1;
  series = [];
  if (!Number.isFinite(count) || count < 1 || count > 3660) {
    $('rangeStatus').textContent = 'Choose an ordered range of up to 3,660 days.';
  } else {
    const horizon = azimuth => skyline(model, azimuth);
    for (let date = start; date <= end; date += day) {
      if (!cache.has(date)) {
        const solar = events(date, position.lat, position.lon, horizon, solarTypes);
        const lunar = lunarEvents(date, position.lat, position.lon, model?.observer ?? position.eye, horizon);
        cache.set(date, [...solar, ...lunar]);
      }
      series.push(...cache.get(date));
    }
    $('rangeStatus').textContent = count.toLocaleString() + (count === 1 ? ' day' : ' days') + ' · ' +
      series.length.toLocaleString() + (series.length === 1 ? ' event' : ' events');
  }
  if (preview && (!Number.isFinite(count) || count < 1 || count > 3660 || preview.date < start || preview.date > end)) preview = null;
  eventSectors = [];
  for (const type of Object.keys(labels)) {
    const angles = series.filter(point => point.type === type).map(point => point.azimuth).sort((a,b) => a - b);
    if (!angles.length) continue;
    // Remove the largest empty gap so a range crossing north stays continuous.
    let gap = -1;
    let first = 0;
    for (const [index, angle] of angles.entries()) {
      const next = angles[index + 1] ?? angles[0] + 360;
      if (next - angle > gap) {
        gap = next - angle;
        first = wrap(next);
      }
    }
    eventSectors.push({type, start:first, sweep:360 - gap});
  }
  updateMatch();
  draw();
}

function localEventClock(latitude, longitude) {
  let timeZone = globalThis.tzlookup?.(latitude, longitude) ?? 'UTC';
  const timeOptions = {hour:'2-digit', minute:'2-digit', hourCycle:'h23'};
  let clock;
  try {
    clock = new Intl.DateTimeFormat('en-GB', {...timeOptions, timeZone});
  } catch {
    timeZone = 'UTC';
    clock = new Intl.DateTimeFormat('en-GB', {...timeOptions, timeZone});
  }
  const localDate = new Intl.DateTimeFormat('en', {dateStyle:'medium', timeZone});
  const adjacentDate = new Intl.DateTimeFormat('en', {month:'short', day:'numeric', timeZone});
  return {
    timeZone,
    format(event) {
      const time = Math.round(event.time / 60000) * 60000;
      const suffix = localDate.format(time) === dateFormat.format(event.date) ? '' : ' (' + adjacentDate.format(time) + ')';
      return clock.format(time) + suffix;
    }
  };
}

async function setPosition(place, preserveTarget = false, savedTarget = null) {
  const current = ++revision;
  position = {...place, eye:Number($('height').value)};
  eventClock = localEventClock(position.lat, position.lon);
  viewpointUnits.setCoordinates(place.lat, place.lon);
  heading = place.view;
  model = null;
  cache.clear();
  if (savedTarget) setTarget(savedTarget.value, savedTarget.name, savedTarget.coordinates);
  else if (target?.coordinates && (preserveTarget || target.name === 'Map target')) {
    if (place.lat === target.coordinates[0] && place.lon === target.coordinates[1]) setTarget(heading);
    else aimAtCoordinates(target.coordinates, target.name, false);
  } else if (preserveTarget && target) setTarget(target.value, target.name);
  else if (place.aim === 'island') aimIsland();
  else setTarget(heading);
  $('terrainHeight').textContent = 'Loading…';
  $('terrainStatus').textContent = 'Loading elevation tiles…';
  refresh();
  try {
    const result = await terrain(place.lat, place.lon, position.eye);
    if (current !== revision) return;
    model = result;
    $('terrainHeight').textContent = result.base === null ? 'Unavailable' :
      Math.round(result.base) + ' m above sea level';
    $('terrainStatus').textContent = result.missing === result.count ? 'Terrain unavailable · sea-horizon estimate' :
      result.missing ? 'Partial terrain · some elevation tiles unavailable' :
      Math.round(result.observer) + ' m above sea level · terrain loaded';
  } catch {
    if (current !== revision) return;
    $('terrainHeight').textContent = 'Unavailable';
    $('terrainStatus').textContent = 'Terrain unavailable · flat-horizon estimate';
  }
  cache.clear();
  refresh();
}

function selectPreview({date, type}) {
  if (preview?.date === date && preview.type === type) return;
  preview = {date, type};
  draw();
}

const updateDateRuler = setupDateRuler({dateFormat, onSelect:date => selectPreview({date, type:null})});

function updateBearingLegend() {
  const percent = azimuth => 50 + 100 * difference(azimuth, heading) / span;
  const revolution = 36000 / span;
  const dayEvents = preview ? cache.get(preview.date) : null;
  const selectionLabel = preview ? dateFormat.format(preview.date) + ' · ' + eventClock.timeZone :
    'Select a bearing to preview its date.';
  if ($('bearingSelection').textContent !== selectionLabel) $('bearingSelection').textContent = selectionLabel;
  const summary = $('selectedEvents');
  summary.hidden = !preview;
  const readings = preview ? Object.entries(labels).map(([type, label]) => {
    const event = dayEvents?.find(point => point.type === type);
    return {type, label:label + ' ' + (event ? eventClock.format(event) : '—'), available:Boolean(event)};
  }) : [];
  const summaryKey = readings.map(({label}) => label).join('|');
  if (summary.dataset.readings !== summaryKey) {
    summary.dataset.readings = summaryKey;
    summary.replaceChildren(...readings.map(({type, label, available}) => {
      const item = document.createElement('span');
      item.className = 'date-bearing ' + type;
      item.textContent = label;
      if (!available) item.title = 'No ' + labels[type].toLowerCase() + ' on this date';
      return item;
    }));
  }
  $('clearPreview').hidden = !preview;
  for (const [type, row] of Object.entries(bearingRows)) {
    const sector = eventSectors.find(item => item.type === type);
    const nearest = preview ? dayEvents?.find(point => point.type === type) : closestByType[type];
    row.track.disabled = !sector;
    const pieces = [];
    if (sector) {
      const width = sector.sweep * 100 / span;
      const start = percent(wrap(sector.start + sector.sweep / 2)) - width / 2;
      for (const shift of [-revolution, 0, revolution]) {
        const left = start + shift;
        const right = left + width;
        if (right < 0 || left > 100) continue;
        pieces.push([Math.max(0, left), Math.min(100, right)]);
      }
    }
    for (const [index, bar] of row.bars.entries()) {
      const piece = pieces[index];
      bar.hidden = !piece;
      if (piece) {
        bar.style.left = piece[0] + '%';
        bar.style.width = (piece[1] - piece[0]) + '%';
      }
    }
    const dot = nearest ? percent(nearest.azimuth) : -1;
    row.dot.hidden = dot < 0 || dot > 100;
    if (!row.dot.hidden) row.dot.style.left = dot + '%';
    let description = 'No events in range';
    if (sector) {
      description = formatDegree(sector.start);
      if (sector.sweep) description += '–' + formatDegree(wrap(sector.start + sector.sweep));
      description += ' true';
      if (!pieces.length) description += ' · outside view';
    }
    if (row.output.textContent !== description) row.output.textContent = description;
    row.output.title = !preview && nearest ? 'Closest to target · ' + formatDegree(nearest.azimuth) + ' true · ' + dateFormat.format(nearest.date) : '';
  }
}

function draw() {
  if (!target) return;
  panoramaMap.update(position, target, heading, span, eventSectors, pins);
  updateBearingLegend();
  updateDateRuler({
    start:parse($('start')), end:parse($('end')),
    selected:preview?.date ?? best?.date
  });
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const bottom = h - 36;
  const seaAltitude = model?.sea ?? 0;
  const azAt = x => wrap(heading + (x / w - .5) * span);
  let high = seaAltitude;
  for (let x = 0; x <= w; x += 4) high = Math.max(high, skyline(model, azAt(x)));
  const pitch = Math.min(w / span, bottom * .52 / Math.max(1, high - seaAltitude));
  const yAt = altitude => bottom - (altitude - seaAltitude) * pitch;
  const xAt = az => w / 2 + difference(az, heading) * w / span;
  metrics = {azAt};

  const sky = ctx.createLinearGradient(0,0,0,bottom);
  sky.addColorStop(0,'#dce6ec');
  sky.addColorStop(1,'#f6f1e3');
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,w,bottom);
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  const interval = span > 75 ? 15 : span > 36 ? 10 : span > 17 ? 5 : 2;
  for (let a = 0; a < 360; a += interval) {
    const x = xAt(a);
    if (x < 22 || x > w - 22) continue;
    ctx.strokeStyle = '#6e828832';
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,bottom); ctx.stroke();
  }

  const fills = ['#b5c3b2','#889f8e','#607e6b'];
  const strokes = ['#8b9f8d','#6f8777','#4c6c5d'];
  if (model) for (const [i, layer] of model.layers.entries()) {
    // Draw only land above the sea line so the foreground cannot hide distant islands.
    let drawing = false;
    ctx.beginPath();
    for (let x = 0; x <= w + 2; x += 2) {
      const sample = azAt(x) * layer.length / 360;
      const j = Math.floor(sample);
      const elevation = layer[j] + (layer[(j + 1) % layer.length] - layer[j]) * (sample - j);
      if (elevation > model.sea + .005) {
        if (!drawing) ctx.moveTo(Math.max(0,x - 2),bottom);
        ctx.lineTo(x,yAt(elevation));
        drawing = true;
      } else if (drawing) {
        ctx.lineTo(x,bottom); ctx.closePath(); drawing = false;
      }
    }
    if (drawing) {ctx.lineTo(w + 2,bottom);ctx.closePath();}
    ctx.fillStyle = fills[i]; ctx.fill();
    ctx.strokeStyle = strokes[i]; ctx.lineWidth = 1; ctx.stroke();
  }

  const tx = xAt(target.value);
  if (tx >= 0 && tx < w) {
    const ty = yAt(skyline(model,target.value));
    ctx.strokeStyle = markers.target.outline; ctx.lineWidth = markers.target.stroke;
    ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(tx,16); ctx.lineTo(tx,bottom); ctx.stroke(); ctx.setLineDash([]);
    drawMarker('target', tx, ty);
  }
  ctx.font = '700 12px system-ui';
  const pinLabels = [];
  for (const pin of pins) {
    if (pin.lat === position.lat && pin.lon === position.lon) continue;
    const azimuth = bearing(position.lat, position.lon, pin.lat, pin.lon);
    const x = xAt(azimuth);
    if (x < 0 || x > w) continue;
    const y = yAt(skyline(model, azimuth));
    drawPlacePin(ctx, x, y, 11);
    if (pin.name) pinLabels.push({x, y, name:pin.name});
  }
  const labelBounds = [];
  for (const {x, y, name} of pinLabels) {
    const width = Math.min(w - 8, ctx.measureText(name).width + 10);
    const center = clamp(x, width / 2 + 4, w - width / 2 - 4);
    const left = center - width / 2;
    let top = y - 54;
    while (labelBounds.some(rect => left < rect.right && left + width > rect.left && Math.abs(top - rect.top) < 19)) top -= 19;
    if (top < 44) continue;
    labelBounds.push({left, right:left + width, top});
    ctx.fillStyle = '#fff8f7';
    ctx.fillRect(left, top, width, 18);
    ctx.fillStyle = '#7d292d';
    ctx.fillText(name, center, top + 13, width - 8);
  }

  const shownEvents = preview ? cache.get(preview.date) ?? [] : best ? [best] : [];
  for (const event of shownEvents) {
    const x = xAt(event.azimuth);
    const y = yAt(event.altitude) - 16;
    if (x < 0 || x > w) continue;
    if (event.type.startsWith('moon')) drawMoonMarker(event, x, y);
    else drawMarker(event.type, x, y, sunMarkerRadius);
  }

  ctx.fillStyle = '#f8f9f2';ctx.fillRect(0,bottom,w,h-bottom);
  ctx.strokeStyle = '#92a49a';ctx.beginPath();ctx.moveTo(0,bottom);ctx.lineTo(w,bottom);ctx.stroke();
  ctx.fillStyle = '#43564d';ctx.font = '600 12px ui-monospace, monospace';
  for (let a = 0; a < 360; a += interval) {
    const x = xAt(a);
    if (x < 20 || x > w - 20) continue;
    ctx.beginPath();ctx.moveTo(x,bottom);ctx.lineTo(x,bottom+6);ctx.stroke();
    ctx.fillText(({0:'N',90:'E',180:'S',270:'W'})[a] ?? a+'°',x,bottom+23);
  }
}

$('help').onclick = () => $('instructions').showModal();
$('position').onsubmit = event => {
  event.preventDefault();
  const coordinates = viewpointUnits.readCoordinates(position);
  if (!coordinates) return;
  const [lat, lon] = coordinates;
  const angleInput = $('targetAngle');
  const distanceInput = $('targetDistance');
  const sameViewpoint = lat === position.lat && lon === position.lon;
  const sameTarget = angleInput.value === angleInput.defaultValue && distanceInput.value === distanceInput.defaultValue;
  let nextTarget = target;
  if (!sameViewpoint || !sameTarget) {
    const angle = angleInput.value === angleInput.defaultValue ? target.value : wrap(angleInput.valueAsNumber);
    const distance = viewpointUnits.readDistance();
    const coordinates = distance > 0 ? destination(lat, lon, angle, distance) : null;
    if (coordinates && Math.abs(coordinates[0]) > 80) {
      distanceInput.setCustomValidity('Choose an angle or distance that keeps the target between 80° S and 80° N.');
      distanceInput.reportValidity();
      distanceInput.setCustomValidity('');
      return;
    }
    nextTarget = {value:angle, name:coordinates ? 'Map target' : 'Selected bearing', coordinates};
  }
  const preset = places.find(place => place.lat === lat && place.lon === lon) ?? places.at(-1);
  setPosition({...preset, lat, lon, view:sameViewpoint && sameTarget ? heading : nextTarget.value}, false, nextTarget);
};
function applyCoordinates(lat, lon, fromMap = false) {
  const preset = places.find(place => place.lat === lat && place.lon === lon);
  const place = preset ?? {...places.at(-1), lat, lon, view:heading};
  setPosition(fromMap ? {...place, view:heading} : place, fromMap);
}
$('center').onclick = centerOnTarget;
$('in').onclick = () => { span = clamp(span / 1.35, 8, 155); draw(); };
$('out').onclick = () => { span = clamp(span * 1.35, 8, 155); draw(); };

for (const input of [$('start'),$('end')]) input.onchange = refresh;
for (const [type, {track}] of Object.entries(bearingRows)) {
  let pointerId;
  function visibleEvents() {
    return series.filter(point => point.type === type && Math.abs(difference(point.azimuth, heading)) <= span / 2);
  }
  function selectedEvent() {
    return cache.get(preview?.date)?.find(point => point.type === type) ?? closestByType[type];
  }
  function scrub(clientX) {
    const bounds = track.getBoundingClientRect();
    const fraction = clamp((clientX - bounds.left) / bounds.width, 0, 1);
    const azimuth = wrap(heading + (fraction - 0.5) * span);
    const nearest = visibleEvents().reduce((closest, point) =>
      !closest || Math.abs(difference(point.azimuth, azimuth)) < Math.abs(difference(closest.azimuth, azimuth)) ? point : closest, null);
    const point = nearest ?? selectedEvent();
    if (point) selectPreview(point);
  }

  track.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary) return;
    pointerId = event.pointerId;
    track.setPointerCapture(pointerId);
  };
  track.onpointermove = event => {
    if (event.pointerId === pointerId) scrub(event.clientX);
  };
  track.onpointerup = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    scrub(event.clientX);
  };
  track.onlostpointercapture = () => { pointerId = undefined; };
  track.onclick = event => {
    if (event.detail === 0) {
      const point = selectedEvent();
      if (point) selectPreview(point);
    }
  };
  track.onkeydown = event => {
    const offset = {ArrowLeft:-1, ArrowRight:1}[event.key];
    if (!offset) return;
    event.preventDefault();
    const points = visibleEvents().sort((a,b) => difference(a.azimuth, heading) - difference(b.azimuth, heading));
    const index = points.indexOf(selectedEvent());
    const point = points[index === -1 ? (offset > 0 ? 0 : points.length - 1) : index + offset];
    if (point) selectPreview(point);
  };
}
$('clearPreview').onclick = () => { preview = null; draw(); };
for (const control of document.querySelectorAll('[data-days]')) control.onclick = () => {
  const start = parse($('start'));
  if (!Number.isFinite(start)) return;
  $('end').value = dateValue(start + day * (Number(control.dataset.days) - 1));
  refresh();
};
canvas.onpointerdown = event => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  drag = {id:event.pointerId, x:event.clientX, heading, moved:false};
};
canvas.onpointermove = event => {
  if (drag?.id !== event.pointerId) return;
  const delta = event.clientX - drag.x;
  if (Math.abs(delta) > 4) drag.moved = true;
  if (drag.moved) {heading = wrap(drag.heading - delta * span / canvas.clientWidth);draw();}
};
canvas.onpointerup = event => {
  if (drag?.id !== event.pointerId) return;
  if (!drag.moved && metrics) setTarget(metrics.azAt(event.clientX - canvas.getBoundingClientRect().left));
  drag = null;
};
canvas.onpointercancel = () => { drag = null; };
canvas.onkeydown = event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();heading = wrap(heading + (event.key === 'ArrowLeft' ? -1 : 1) * span / 12);draw();
  } else if (event.key === 'Enter') setTarget(heading);
};
function persistPins() {
  const saved = writeStoredPins(pins);
  $('pinStorageStatus').textContent = saved ? '' : 'Pins could not be saved in this browser.';
  $('pinStorageStatus').hidden = saved;
}

function restoreConfiguration(config) {
  const {viewpoint, target:savedTarget, start, end} = config;
  $('height').value = viewpoint.eye;
  $('start').value = start;
  $('end').value = end;
  span = config.span;
  pins = config.pins ?? [];
  panoramaMap.restoreZoom(config.mapZoom);
  preview = config.preview ? {...config.preview, date:Date.parse(config.preview.date + 'T00:00:00Z')} : null;
  const place = places.find(item => item.lat === viewpoint.lat && item.lon === viewpoint.lon) ?? places.at(-1);
  return setPosition({...place, lat:viewpoint.lat, lon:viewpoint.lon, view:config.heading}, false, savedTarget);
}

setupSnapshots({
  capture: () => ({
    viewpoint:{lat:position.lat, lon:position.lon, eye:position.eye},
    target,
    heading, span, mapZoom:panoramaMap.getZoom(), pins,
    start:$('start').value,
    end:$('end').value,
    preview:preview ? {...preview, date:dateValue(preview.date)} : null
  }),
  restore:config => {
    restoreConfiguration({...config, pins:mergePins(pins, config.pins ?? [])});
    persistPins();
  }
});

new ResizeObserver(draw).observe(canvas);
restoreConfiguration({...defaultConfiguration, pins:readStoredPins()});
