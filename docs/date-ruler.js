import {day} from './solar.js?v=moon';

export function setupDateRuler({dateFormat, onSelect}) {
  const ruler = document.getElementById('dateRuler');
  const ticks = document.getElementById('dateTicks');
  const handle = document.getElementById('dateHandle');
  const shortDate = new Intl.DateTimeFormat('en', {month:'short', day:'numeric', timeZone:'UTC'});
  let first, previousKey, labels = [];

  handle.oninput = () => onSelect(first + Number(handle.value) * day);
  handle.onkeydown = event => {
    // Keep the visual order: later dates are farther down the ruler.
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    handle.value = Number(handle.value) + offset;
    handle.oninput();
  };

  return ({start, end, selected}) => {
    const days = Math.round((end - start) / day);
    ruler.hidden = !Number.isFinite(days) || days < 0 || days >= 3660;
    if (ruler.hidden) return;

    first = start;
    const date = selected ?? start;
    const height = ticks.clientHeight;
    const key = [start, end, height].join('/');
    if (key !== previousKey) {
      previousKey = key;
      handle.min = 0;
      handle.max = Math.max(1, days);
      handle.disabled = days === 0;
      const intervals = Math.min(days, Math.max(1, Math.floor(height / 9)));
      const labelEvery = Math.max(1, Math.ceil(27 * intervals / Math.max(1, height)));
      labels = [];
      const elements = [];
      for (let index = 0; index <= intervals; index++) {
        const offset = Math.round(index * days / Math.max(1, intervals));
        const tickDate = start + offset * day;
        const labeled = index === 0 || index === intervals ||
          (index % labelEvery === 0 && intervals - index >= labelEvery);
        const tick = document.createElement(labeled ? 'button' : 'span');
        tick.className = 'date-tick';
        tick.style.top = (days ? offset / days * 100 : 0) + '%';
        if (labeled) {
          tick.type = 'button';
          tick.textContent = shortDate.format(tickDate);
          tick.setAttribute('aria-label', dateFormat.format(tickDate));
          tick.onclick = () => onSelect(tickDate);
          labels.push({tick, date:tickDate});
        }
        elements.push(tick);
      }
      ticks.replaceChildren(...elements);
    }
    if (days > 0) handle.value = Math.round((date - start) / day);
    else handle.value = 0;
    handle.setAttribute('aria-valuetext', dateFormat.format(date));
    for (const label of labels) label.tick.setAttribute('aria-current', label.date === date ? 'date' : 'false');
  };
}
