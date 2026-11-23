const storageKey = 'solhorizon.snapshots.v1';
const day = 86400000;
const eventTypes = [null, 'rise', 'set', 'moonrise', 'moonset'];

function within(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}

export function normalizeSnapshot(snapshot) {
  if (snapshot?.format !== 'solhorizon-snapshot' || snapshot.version !== 1) {
    throw new Error('Choose a Solhorizon snapshot JSON file.');
  }
  const name = typeof snapshot.name === 'string' ? snapshot.name.trim() : '';
  const {viewpoint, target, heading, span, mapZoom = null, start, end, preview, pins = []} = snapshot.configuration ?? {};
  const first = parseDate(start);
  const last = parseDate(end);
  const coordinates = target?.coordinates;
  const selected = preview ? parseDate(preview.date) : null;
  if (!name || name.length > 100 ||
      !within(viewpoint?.lat, -80, 80) || !within(viewpoint?.lon, -180, 180) || !within(viewpoint?.eye, 0, 10000) ||
      !within(target?.value, 0, 360) || target.value === 360 || typeof target.name !== 'string' || target.name.length > 100 ||
      !(coordinates === null || (Array.isArray(coordinates) && coordinates.length === 2 &&
        within(coordinates[0], -80, 80) && within(coordinates[1], -180, 180))) ||
      !within(heading, 0, 360) || heading === 360 || !within(span, 8, 155) || (mapZoom !== null && !within(mapZoom, 0, 19)) ||
      !within(last - first, 0, 3659 * day) ||
      !Array.isArray(pins) || pins.some(pin => !within(pin?.lat, -85, 85) || !within(pin?.lon, -180, 180) ||
        typeof pin.name !== 'string' || pin.name.length > 100) ||
      !(preview === null || (within(selected, first, last) && eventTypes.includes(preview?.type)))) {
    throw new Error('The snapshot has invalid settings. Check the name, coordinates, and date range.');
  }
  return {
    format:'solhorizon-snapshot', version:1, name,
    configuration:{
      viewpoint:{lat:viewpoint.lat, lon:viewpoint.lon, eye:viewpoint.eye},
      target:{value:target.value, name:target.name, coordinates},
      heading, span, mapZoom, start, end,
      pins:pins.map(({lat, lon, name}) => ({lat, lon, name})),
      preview:preview ? {date:preview.date, type:preview.type} : null
    }
  };
}

export function setupSnapshots({capture, restore}) {
  const $ = id => document.getElementById(id);
  const list = $('snapshotList');
  const file = $('snapshotFile');
  const name = $('snapshotName');
  const status = $('snapshotStatus');
  let saved = [];

  function readLibrary() {
    const entries = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(entries)) throw new Error('Snapshot storage is unavailable.');
    return entries.flatMap(entry => {
      try {
        if (typeof entry.id !== 'string') return [];
        return [{id:entry.id, snapshot:normalizeSnapshot(entry.snapshot)}];
      } catch {
        return [];
      }
    });
  }

  function updateButtons() {
    $('loadSnapshot').disabled = $('exportSnapshot').disabled = !list.value;
  }
  function render(selected) {
    list.replaceChildren(new Option(saved.length ? 'Choose a snapshot' : 'No saved snapshots', ''));
    for (const {id, snapshot} of saved) list.add(new Option(snapshot.name, id));
    list.value = selected ?? '';
    updateButtons();
  }
  function add(snapshot) {
    let entries;
    try {
      entries = readLibrary();
      const id = crypto.randomUUID();
      saved = [{id, snapshot}, ...entries];
      localStorage.setItem(storageKey, JSON.stringify(saved));
      render(id);
    } catch {
      saved = entries ?? saved;
      throw new Error('Could not save the snapshot in this browser.');
    }
  }

  try {
    saved = readLibrary();
    render();
  } catch {
    render();
    status.textContent = 'Saved snapshots could not be read in this browser.';
  }
  list.onchange = updateButtons;
  $('saveSnapshot').onsubmit = event => {
    event.preventDefault();
    try {
      const snapshot = normalizeSnapshot({
        format:'solhorizon-snapshot', version:1, name:name.value, configuration:capture()
      });
      add(snapshot);
      status.textContent = 'Saved “' + snapshot.name + '”.';
      name.value = '';
    } catch (error) {
      status.textContent = error.message;
    }
  };

  const selection = () => saved.find(entry => entry.id === list.value)?.snapshot;
  $('loadSnapshot').onclick = () => {
    const snapshot = selection();
    if (!snapshot) return;
    restore(snapshot.configuration);
    status.textContent = 'Loaded “' + snapshot.name + '”.';
  };
  $('exportSnapshot').onclick = () => {
    const snapshot = selection();
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2) + '\n'], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = snapshot.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
    link.href = url;
    link.download = filename + '.solhorizon.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Exported “' + snapshot.name + '”.';
  };
  $('importSnapshot').onclick = () => file.click();
  file.onchange = async () => {
    const source = file.files[0];
    file.value = '';
    if (!source) return;
    try {
      if (source.size > 1048576) throw new Error('Choose a snapshot JSON file under 1 MB.');
      let data;
      try {
        data = JSON.parse(await source.text());
      } catch {
        throw new Error('This file could not be read as JSON.');
      }
      const snapshot = normalizeSnapshot(data);
      add(snapshot);
      status.textContent = 'Imported “' + snapshot.name + '”. Select Load to restore it.';
    } catch (error) {
      status.textContent = error.message;
    }
  };
}
