/* Public GitHub contribution snapshot fetched 2026-08-11. No framework or build step required. */
const levels = '0000000000000000000000000000000000000000000000000002100000000000000000000000000000000000000000000000010111000000000000000000000000000000000000000000000000102100000000000000000000000000000000000000000000001000004000000000000000000000000000000000000000000000000004300000000000000000000000000000000000000000000000001320000000000000000000000000000000000000000000000001111';
const graph = document.querySelector('#graph');
const yearStart = new Date('2025-08-10T00:00:00');
const start = new Date('2026-05-31T00:00:00');
const daysToShow = 77;
const offset = Math.round((start - yearStart) / 86400000);

for (let blank = 0; blank < start.getDay(); blank += 1) {
  graph.append(document.createElement('span'));
}
for (let index = 0; index < daysToShow; index += 1) {
  const calendarIndex = offset + index;
  const week = Math.floor(calendarIndex / 7);
  const day = calendarIndex % 7;
  const level = levels[day * 53 + week] || '0';
  const date = new Date(start);
  date.setDate(start.getDate() + index);
  const cell = document.createElement('span');
  cell.className = 'day';
  cell.dataset.level = level;
  cell.title = `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}: contribution activity`;
  cell.setAttribute('role', 'gridcell');
  graph.append(cell);
}
