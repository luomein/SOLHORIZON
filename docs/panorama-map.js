import {placeName} from './place-names.js';
import {difference, wrap} from './solar.js';

const radians = Math.PI / 180;

function bearingPath([latitude, longitude], [targetLatitude, targetLongitude], bearing) {
  const start = latitude * radians;
  const end = targetLatitude * radians;
  const halfLongitude = difference(targetLongitude, longitude) * radians / 2;
  const haversine = Math.sin((end - start) / 2) ** 2 + Math.cos(start) * Math.cos(end) * Math.sin(halfLongitude) ** 2;
  const distance = 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
  const azimuth = bearing * radians;
  const points = [[latitude, longitude]];
  for (let i = 1; i < 24; i++) {
    const leg = distance * i / 24;
    const lat = Math.asin(Math.sin(start) * Math.cos(leg) + Math.cos(start) * Math.sin(leg) * Math.cos(azimuth));
    const lon = Math.atan2(Math.sin(azimuth) * Math.sin(leg) * Math.cos(start), Math.cos(leg) - Math.sin(start) * Math.sin(lat));
    const nextLongitude = longitude + lon / radians;
    const previousLongitude = points.at(-1)[1];
    points.push([lat / radians, previousLongitude + difference(nextLongitude, previousLongitude)]);
  }
  const previousLongitude = points.at(-1)[1];
  points.push([targetLatitude, previousLongitude + difference(targetLongitude, previousLongitude)]);
  return points;
}

function mapTiles(attribution = '') {
  return window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution});
}

function ringTracks(size, sectors) {
  const gap = 2;
  const width = Math.min(5, size * 0.035);
  const rim = size / 2 - 2;
  return sectors.map((item, index) => {
    const outer = rim - (sectors.length - 1 - index) * (width + gap);
    return {...item, inner:outer - width, outer};
  });
}

export function drawPlacePin(ctx, x, y, height) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-height * .14, -height * .32, -height * .46, -height * .46, -height * .46, -height * .66);
  ctx.arc(0, -height * .66, height * .46, Math.PI, 0);
  ctx.bezierCurveTo(height * .46, -height * .46, height * .14, -height * .32, 0, 0);
  ctx.fillStyle = '#ab3e49';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -height * .66, height * .14, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}

export function setupPanoramaMap({turnTo, moveViewpoint, moveTarget, changePins, resetView, markers}) {
  const overlay = document.getElementById('panoramaMap');
  const compass = document.getElementById('mapCompass');
  const canvas = document.getElementById('panoramaDirections');
  const ctx = canvas.getContext('2d');
  const targetMarker = markers.target;
  let map, current, geometry, projectKey, drag, expandedMap, expandedLayers;
  let mapZoom = null;
  let zoomOffset = null;
  let expandedPinDragging = false;

  function draw() {
    if (!current) return;
    const {position, target, heading, span, eventSectors, pins} = current;
    const size = canvas.clientWidth;
    if (!size) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const backing = Math.round(size * pixelRatio);
    if (canvas.width !== backing || canvas.height !== backing) canvas.width = canvas.height = backing;
    const center = size / 2;
    const radius = center - 7;
    const origin = [position.lat, position.lon];
    const key = [size, ...origin, ...(target.coordinates ?? []), target.coordinates ? target.value : '', mapZoom].join('/');
    if (key !== projectKey) {
      geometry = null;
      if (map) {
        map.invalidateSize({pan: false, animate: false});
        const path = target.coordinates ? bearingPath(origin, target.coordinates, target.value) : [];
        const start = map.project(origin, 0);
        const distance = Math.max(0, ...path.map(point => start.distanceTo(map.project(point, 0))));
        const zoom = distance ? Math.max(0, Math.min(15, Math.floor(Math.log2((radius - 8) / distance)))) : 13;
        map.setView(origin, mapZoom ?? zoom, {animate: false});
        geometry = path.length ? path.map(point => map.latLngToContainerPoint(point)) : null;
      }
      projectKey = key;
    }

    ctx.setTransform(backing / size, 0, 0, backing / size, 0, 0);
    ctx.clearRect(0, 0, size, size);
    function radial(angle, distance) {
      return {x: center + Math.sin(angle * radians) * distance, y: center - Math.cos(angle * radians) * distance};
    }
    function line(points, color, width, dash = []) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function marker(x, y, radius, fill, outline, width) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    function sector(start, sweep, inner, outer, fill, outline, opacity) {
      if (sweep === 0) {
        line([radial(start, inner), radial(start, outer)], outline, 2);
        return;
      }
      const first = (start - 90) * radians;
      const last = (start + sweep - 90) * radians;
      ctx.beginPath();
      ctx.arc(center, center, outer, first, last);
      if (inner > 0) ctx.arc(center, center, inner, last, first, true);
      else ctx.lineTo(center, center);
      ctx.closePath();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const rim = center - 2;
    sector(heading - span / 2, span, 0, rim, '#498eca', '#215d88', 0.28);
    for (const {type, start, sweep, inner, outer} of ringTracks(size, eventSectors)) {
      const {fill, outline} = markers[type];
      sector(start, sweep, inner, outer, fill, outline, 1);
    }

    const viewpoint = drag?.kind === 'viewpoint' && drag.point ? drag.point : {x:center, y:center};
    const targetPoint = drag?.kind === 'target' && drag.point ? drag.point : geometry?.at(-1);
    const path = drag?.point && targetPoint ? [viewpoint, targetPoint] :
      geometry ?? [viewpoint, radial(target.value, radius)];
    line(path, '#fcfcf5', 4);
    line(path, targetMarker.outline, 2, [4, 3]);
    if (targetPoint) marker(targetPoint.x, targetPoint.y, targetMarker.radius, targetMarker.fill, targetMarker.outline, 2);
    marker(viewpoint.x, viewpoint.y, 4, '#253b31', '#fcfcf5', 2);
    if (map) for (const pin of pins) {
      const point = map.latLngToContainerPoint([pin.lat, position.lon + difference(pin.lon, position.lon)]);
      if (Math.hypot(point.x - center, point.y - center) < center) drawPlacePin(ctx, point.x, point.y, 9);
    }
    if (dialog.open && zoomOffset !== null && !expandedPinDragging) drawExpandedMap();
  }

  const expand = document.getElementById('expandPanoramaMap');
  const dialog = document.getElementById('expandedPanoramaMap');
  const pinButton = document.getElementById('pinMode');
  const mapElement = document.getElementById('expandedMapTiles');
  let pinMode = false;

  function setPinMode(active) {
    pinMode = active;
    pinButton.setAttribute('aria-pressed', String(active));
    mapElement.classList.toggle('pin-mode', active);
    if (dialog.open && expandedLayers) drawExpandedMap();
  }

  pinButton.onclick = () => setPinMode(!pinMode);
  dialog.onclose = () => {
    expandedPinDragging = false;
    setPinMode(false);
  };

  function placePin(location, index = current.pins.length) {
    const point = location.wrap();
    if (Math.abs(point.lat) > 85) {
      drawExpandedMap();
      return;
    }
    const pin = {lat:Number(point.lat.toFixed(6)), lon:Number(point.lng.toFixed(6)), name:''};
    const viewPoint = expandedMap.latLngToContainerPoint(location);
    const nearby = expandedMap.containerPointToLatLng([viewPoint.x + 12, viewPoint.y]);
    const radius = Math.max(30, Math.min(250, Math.round(location.distanceTo(nearby))));
    const updated = [...current.pins];
    updated[index] = pin;
    changePins(updated);
    placeName(pin.lat, pin.lon, radius).then(name => {
      const index = current.pins.indexOf(pin);
      if (!name || index === -1) return;
      changePins(current.pins.map((item, i) => i === index ? {...item, name} : item));
    });
  }
  expand.onclick = () => {
    if (!map || !current) return;
    dialog.showModal();
    const L = window.L;
    if (!expandedMap) {
      expandedMap = L.map('expandedMapTiles', {minZoom:0, maxZoom:24, zoomSnap:0.25, zoomAnimation:false,
        scrollWheelZoom:'center', doubleClickZoom:'center', touchZoom:'center'});
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxNativeZoom:19, maxZoom:24,
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
      }).addTo(expandedMap);
      expandedLayers = L.layerGroup().addTo(expandedMap);
      expandedMap.on('click', event => {
        if (pinMode) { placePin(event.latlng); return; }
        if (current.target.coordinates) return;
        const point = event.latlng.wrap();
        if (Math.abs(point.lat) <= 80 && (point.lat !== current.position.lat || point.lng !== current.position.lon)) {
          moveTarget([point.lat, point.lng]);
        }
      });
      expandedMap.on('zoomend', () => {
        if (zoomOffset === null) return;
        mapZoom = expandedMap.getZoom() - zoomOffset;
        draw();
      });
    }
    zoomOffset = null;
    expandedMap.setMinZoom(0);
    expandedMap.setMaxZoom(24);
    expandedMap.invalidateSize({pan:false});
    const coverage = drawExpandedMap();
    expandedMap.fitBounds(coverage.getBounds(), {padding:[24,24], animate:false});
    zoomOffset = expandedMap.getZoom() - map.getZoom();
    expandedMap.setMinZoom(zoomOffset);
    expandedMap.setMaxZoom(zoomOffset + 19);
  };

  document.getElementById('resetPanoramaMap').onclick = () => {
    if (!expandedMap || !map) return;
    expandedMap.stop();
    const center = expandedMap.getCenter().wrap();
    if (Math.abs(center.lat) > 80) {
      document.getElementById('expandedMapHint').textContent = 'Move the map center between 80° S and 80° N to reset.';
      return;
    }

    const zoom = map.getZoom();
    const pixel = map.project(center, zoom);
    pixel.x += canvas.clientWidth / 2;
    const coverageRadius = center.distanceTo(map.unproject(pixel, zoom));
    // Leaflet distanceTo uses a sphere with a radius of 6,371 km.
    const arc = coverageRadius / (2 * 6371000);
    const latitude = center.lat * radians;
    const eastLat = Math.asin(Math.sin(latitude) * Math.cos(arc));
    const eastLon = center.lng + Math.atan2(Math.sin(arc), Math.cos(latitude) * Math.cos(arc)) / radians;

    mapZoom = zoom;
    resetView([center.lat, center.lng], [eastLat / radians, wrap(eastLon + 180) - 180]);
  };

  function drawExpandedMap() {
    const L = window.L;
    expandedLayers.clearLayers();
    const {position, target, heading, span, eventSectors, pins} = current;
    const hint = document.getElementById('expandedMapHint');
    hint.textContent = pinMode ? 'Click the map to add a pin. Drag a pin to move it, or click it to remove it.' :
      target.coordinates ? 'Drag a marker to move it. Click a red pin to remove it.' :
      'Drag the viewpoint or click the map to place a target. Click a red pin to remove it.';
    const origin = [position.lat, position.lon];
    const size = canvas.clientWidth;
    const center = size / 2;
    const rim = center - 2;
    const at = (angle, radius) => map.containerPointToLatLng([
      center + radius * Math.sin(angle * radians),
      center - radius * Math.cos(angle * radians)
    ]);
    function arc(start, sweep, radius) {
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 5));
      return Array.from({length:steps + 1}, (_, i) => at(start + sweep * i / steps, radius));
    }

    const coverage = L.polygon(arc(0, 360, center), {
      color:'#384943', weight:2, dashArray:'2 6', fill:false, interactive:false
    }).addTo(expandedLayers);
    L.polygon([origin, ...arc(heading - span / 2, span, rim)], {
      color:'#215d88', weight:2, dashArray:'2 5', fillColor:'#498eca', fillOpacity:0.14, interactive:false
    }).addTo(expandedLayers);
    for (const {type, start, sweep, inner, outer} of ringTracks(size, eventSectors)) {
      const {fill, outline} = markers[type];
      if (sweep) {
        L.polygon([...arc(start, sweep, outer), ...arc(start + sweep, -sweep, inner)], {
          color:outline, fillColor:fill, fillOpacity:1, weight:1, interactive:false
        }).addTo(expandedLayers);
      } else {
        L.polyline([at(start, inner), at(start, outer)], {color:outline, weight:2, interactive:false}).addTo(expandedLayers);
      }
    }
    const line = target.coordinates ? bearingPath(origin, target.coordinates, target.value) : [origin, at(target.value, rim)];
    L.polyline(line, {color:targetMarker.outline, weight:2, dashArray:'5 4', interactive:false}).addTo(expandedLayers);
    function pin(point, label, kind, move) {
      const icon = L.divIcon({className:'expanded-map-pin ' + kind, iconSize:[16,16], iconAnchor:[8,8]});
      L.marker(point, {icon, draggable:true, title:label})
        .on('dragstart', () => { expandedPinDragging = true; })
        .on('dragend', event => {
          expandedPinDragging = false;
          const location = event.target.getLatLng().wrap();
          const coordinates = [Number(location.lat.toFixed(6)), Number(location.lng.toFixed(6))];
          const other = kind === 'viewpoint' ? target.coordinates : origin;
          if (Math.abs(coordinates[0]) > 80 || other?.every((value, index) => value === coordinates[index])) {
            drawExpandedMap();
            return;
          }
          mapZoom = map.getZoom();
          move(coordinates);
          if (kind === 'viewpoint') expandedMap.panTo(coordinates, {animate:false});
        }).addTo(expandedLayers);
    }
    pin(origin, 'Drag viewpoint', 'viewpoint', moveViewpoint);
    if (target.coordinates) pin(line.at(-1), 'Drag target', 'target', moveTarget);
    for (const [index, place] of pins.entries()) {
      const icon = L.divIcon({className:'expanded-place-pin place-pin-icon', iconSize:[20,22], iconAnchor:[10,20]});
      const marker = L.marker([place.lat, position.lon + difference(place.lon, position.lon)], {
        icon, draggable:true, title:place.name ? 'Remove ' + place.name : 'Remove pin ' + (index + 1)
      }).addTo(expandedLayers);
      marker.on('dragstart', () => { expandedPinDragging = true; });
      marker.on('dragend', () => {
        expandedPinDragging = false;
        placePin(marker.getLatLng(), index);
      });
      marker.on('click', event => {
        L.DomEvent.stopPropagation(event.originalEvent);
        changePins(current.pins.filter((_, i) => i !== index));
      });
      if (place.name) {
        const tooltip = document.createElement('span');
        tooltip.textContent = place.name;
        marker.bindTooltip(tooltip);
      }
    }
    return coverage;
  }

  function pointerPosition(event) {
    const bounds = compass.getBoundingClientRect();
    return {x:event.clientX - bounds.left, y:event.clientY - bounds.top};
  }

  function hitPoint(point) {
    if (!map) return null;
    const center = canvas.clientWidth / 2;
    const target = geometry?.at(-1);
    const viewpointDistance = Math.hypot(point.x - center, point.y - center);
    const targetDistance = target ? Math.hypot(point.x - target.x, point.y - target.y) : Infinity;
    if (Math.min(viewpointDistance, targetDistance) > 13) return null;
    return targetDistance < viewpointDistance ? {kind:'target', marker:target} :
      {kind:'viewpoint', marker:{x:center, y:center}};
  }

  function droppedPosition(event) {
    const pointer = pointerPosition(event);
    const center = canvas.clientWidth / 2;
    const east = drag.marker.x + pointer.x - drag.start.x - center;
    const south = drag.marker.y + pointer.y - drag.start.y - center;
    const scale = Math.min(1, (center - 8) / Math.max(1, Math.hypot(east, south)));
    return {x:center + east * scale, y:center + south * scale};
  }

  function mapCoordinates(point) {
    const location = map.containerPointToLatLng([point.x, point.y]).wrap();
    return [Number(location.lat.toFixed(6)), Number(location.lng.toFixed(6))];
  }

  function clearDrag() {
    drag = null;
    compass.style.cursor = '';
    draw();
  }

  compass.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const start = pointerPosition(event);
    const hit = hitPoint(start);
    drag = {...hit, id:event.pointerId, start};
    compass.setPointerCapture(event.pointerId);
    compass.focus({preventScroll:true});
    if (hit) compass.style.cursor = 'grabbing';
  };
  compass.onpointermove = event => {
    if (drag?.id !== event.pointerId) {
      if (!drag) compass.style.cursor = hitPoint(pointerPosition(event)) ? 'grab' : '';
      return;
    }
    const point = pointerPosition(event);
    if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= 4) drag.moved = true;
    if (drag.moved && drag.kind) {
      drag.point = droppedPosition(event);
      draw();
    }
  };
  compass.onpointerup = event => {
    if (drag?.id !== event.pointerId) return;
    const {kind, moved} = drag;
    const point = kind && moved ? droppedPosition(event) : pointerPosition(event);
    clearDrag();
    if (kind && moved) {
      const coordinate = mapCoordinates(point);
      if (Math.abs(coordinate[0]) > 80) return;
      if (kind === 'viewpoint') moveViewpoint(coordinate);
      else if (coordinate[0] !== current.position.lat || coordinate[1] !== current.position.lon) moveTarget(coordinate);
    } else if (!moved) {
      const center = canvas.clientWidth / 2;
      const east = point.x - center;
      const north = center - point.y;
      if (Math.hypot(east, north) > 7) turnTo(wrap(Math.atan2(east, north) / radians));
    }
  };
  compass.onlostpointercapture = event => {
    if (drag?.id === event.pointerId) clearDrag();
  };
  compass.onkeydown = event => {
    if (!current || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    turnTo(current.heading + (event.key === 'ArrowLeft' ? -1 : 1) * current.span / 12);
  };
  new ResizeObserver(draw).observe(compass);

  function update(position, target, heading, span, eventSectors, pins) {
    current = {position, target, heading, span, eventSectors, pins};
    if (overlay.hidden) {
      overlay.hidden = false;
      const L = window.L;
      expand.disabled = !L;
      if (L) {
        map = L.map('panoramaTiles', {attributionControl:false, zoomControl:false, dragging:false, keyboard:false,
          scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, touchZoom:false, zoomAnimation:false, zoomSnap:0.25, minZoom:0, maxZoom:19});
        map.setView([position.lat, position.lon], 13);
        mapTiles().addTo(map);
      }
    }
    draw();
  }
  return {update, getZoom:() => mapZoom, restoreZoom:zoom => { mapZoom = zoom; }};
}
