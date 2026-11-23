const storageKey = 'solhorizon.viewpoint-units';
const factors = {km:1, mi:1.609344, nm:1.852};

export function parseCoordinate(value, axis) {
  const text = value.trim().toUpperCase();
  if (!text) return NaN;
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)(?:[°\s]+(\d+(?:\.\d+)?)(?:['′\s]+(\d+(?:\.\d+)?))?["″′'\s]*)?\s*°?\s*([NSEW])?$/u);
  if (!match) return NaN;
  const [, degrees, minutes = '0', seconds = '0', hemisphere] = match;
  const directions = axis === 'lat' ? 'NS' : 'EW';
  if ((hemisphere && !directions.includes(hemisphere)) || Number(minutes) >= 60 || Number(seconds) >= 60) return NaN;
  if (hemisphere && degrees.startsWith('-') && 'NE'.includes(hemisphere)) return NaN;
  const negative = degrees.startsWith('-') || (hemisphere && 'SW'.includes(hemisphere));
  return (negative ? -1 : 1) * (Math.abs(Number(degrees)) + Number(minutes) / 60 + Number(seconds) / 3600);
}

function coordinateText(value, axis, format) {
  if (format === 'decimal') return String(value);
  const thousandths = Math.round(Math.abs(value) * 3600000);
  const degrees = Math.floor(thousandths / 3600000);
  const minutes = Math.floor(thousandths / 60000) % 60;
  const seconds = (thousandths % 60000) / 1000;
  const direction = axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
  return degrees + '° ' + minutes + '′ ' + seconds + '″ ' + direction;
}

export function setupViewpointUnits() {
  const $ = id => document.getElementById(id);
  const coords = $('coordinateFormat');
  const units = $('distanceUnit');
  const distance = $('targetDistance');
  const coordinateInputs = {lat:$('lat'), lon:$('lon')};
  let format = 'decimal';
  let unit = 'km';
  try {
    const preferences = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (preferences.format === 'dms') format = 'dms';
    if (Object.hasOwn(factors, preferences.unit)) unit = preferences.unit;
  } catch {
    // Defaults work when local storage is unavailable.
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({format, unit}));
    } catch {
      // Units remain usable for the current page.
    }
  }

  function configureCoordinateInputs() {
    for (const input of Object.values(coordinateInputs)) input.type = format === 'dms' ? 'text' : 'number';
  }
  function configureDistanceInput() {
    $('targetDistanceUnit').textContent = unit;
    distance.max = distanceText(20015);
  }
  function distanceText(km) {
    return km === null ? '' : String(Number((km / factors[unit]).toFixed(6)));
  }

  coords.value = format;
  units.value = unit;
  configureCoordinateInputs();
  configureDistanceInput();

  coords.onchange = () => {
    const values = Object.entries(coordinateInputs).map(([axis, input]) => ({
      axis, input, value:format === 'decimal' ? input.valueAsNumber : parseCoordinate(input.value, axis),
      previous:input.defaultValue && (format === 'decimal' ? Number(input.defaultValue) : parseCoordinate(input.defaultValue, axis)),
      raw:input.value
    }));
    if (values.some(({value, raw}) => raw && !Number.isFinite(value))) {
      coords.value = format;
      const invalid = values.find(({value, raw}) => raw && !Number.isFinite(value));
      invalid.input.setCustomValidity('Enter a valid coordinate before switching formats.');
      invalid.input.reportValidity();
      invalid.input.setCustomValidity('');
      return;
    }
    format = coords.value;
    configureCoordinateInputs();
    for (const {axis, input, value, previous} of values) {
      input.defaultValue = Number.isFinite(previous) ? coordinateText(previous, axis, format) : '';
      input.value = Number.isFinite(value) ? coordinateText(value, axis, format) : '';
    }
    save();
  };
  units.onchange = () => {
    const current = distance.value === '' ? null : Number(distance.value) * factors[unit];
    const previous = distance.defaultValue === '' ? null : Number(distance.defaultValue) * factors[unit];
    unit = units.value;
    configureDistanceInput();
    distance.defaultValue = distanceText(previous);
    distance.value = distanceText(current);
    save();
  };

  return {
    setCoordinates(lat, lon) {
      for (const [axis, value] of Object.entries({lat, lon})) {
        const input = coordinateInputs[axis];
        input.value = input.defaultValue = coordinateText(value, axis, format);
      }
    },
    readCoordinates(position) {
      const values = [];
      for (const [axis, input] of Object.entries(coordinateInputs)) {
        const value = input.value === input.defaultValue ? position[axis] :
          format === 'decimal' ? input.valueAsNumber : parseCoordinate(input.value, axis);
        const limit = axis === 'lat' ? 80 : 180;
        if (!Number.isFinite(value) || Math.abs(value) > limit) {
          input.setCustomValidity('Enter a coordinate between −' + limit + '° and ' + limit + '°.');
          input.reportValidity();
          input.setCustomValidity('');
          return null;
        }
        values.push(value);
      }
      return values;
    },
    setDistance(km) {
      distance.value = distance.defaultValue = distanceText(km);
    },
    readDistance() {
      return Number(distance.value) * factors[unit];
    }
  };
}
