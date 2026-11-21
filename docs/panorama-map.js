import {bearing, difference, wrap} from './solar.js';

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

export function setupPanoramaMap({turnTo, moveViewpoint, moveTarget, markers}) {
  const overlay = document.getElementById('panoramaMap');
  const compass = document.getElementById('mapCompass');
  const canvas = document.getElementById('panoramaDirections');
  const caption = document.getElementById('compassBearing');
  const ctx = canvas.getContext('2d');
  const targetMarker = markers.target;
  let map, current, geometry, projectKey, drag, expandedMap, expandedLayers;
  let mapZoom = null;
  let zoomOffset = null;
  let expandedPinDragging = false;

  function draw() {
    if (!current) return;
    const {position, target, heading, span, eventSectors} = current;
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
    const text = 'Target ' + (drag?.bearing ?? target.value).toFixed(1) + '° true';
    if (caption.textContent !== text) caption.textContent = text;
    if (dialog.open && zoomOffset !== null && !expandedPinDragging) drawExpandedMap();
  }

  const expand = document.getElementById('expandPanoramaMap');
  const dialog = document.getElementById('expandedPanoramaMap');
  dialog.onclose = () => { expandedPinDragging = false; };
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

  function drawExpandedMap() {
    const L = window.L;
    expandedLayers.clearLayers();
    const {position, target, heading, span, eventSectors} = current;
    const hint = document.getElementById('expandedMapHint');
    hint.textContent = target.coordinates ? 'Drag either pin. Zoom to change the mini-map’s scale.' :
      'Drag the viewpoint or click the map to place a target. Zoom to change the mini-map’s scale.';
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
      if (drag.kind === 'viewpoint' && current.target.coordinates) {
        const coordinates = mapCoordinates(drag.point);
        const destination = current.target.coordinates;
        drag.bearing = Math.abs(coordinates[0]) <= 80 && coordinates.some((value, index) => value !== destination[index]) ?
          bearing(...coordinates, ...destination) : current.target.value;
      }
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

  function update(position, target, heading, span, eventSectors) {
    current = {position, target, heading, span, eventSectors};
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
