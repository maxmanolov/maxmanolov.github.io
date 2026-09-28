// Public GitHub contribution snapshot refreshed September 28, 2026.
const contributions = {
  "2026-07-13": [6, 1],
  "2026-07-14": [1, 1],
  "2026-07-18": [14, 1],
  "2026-07-24": [5, 1],
  "2026-07-27": [14, 1],
  "2026-07-28": [65, 3],
  "2026-07-30": [133, 4],
  "2026-07-31": [103, 4],
  "2026-08-01": [10, 1],
  "2026-08-02": [71, 3],
  "2026-08-03": [1, 1],
  "2026-08-04": [27, 2],
  "2026-08-05": [160, 4],
  "2026-08-06": [91, 4],
  "2026-08-07": [47, 2],
  "2026-08-08": [33, 2],
  "2026-08-09": [18, 1],
  "2026-08-10": [6, 1],
  "2026-08-11": [3, 1],
  "2026-08-15": [86, 4],
  "2026-08-16": [36, 2],
  "2026-09-03": [16, 1],
  "2026-09-05": [15, 1],
  "2026-09-07": [11, 1],
  "2026-09-21": [40, 2],
};

const graph = document.querySelector("#graph");
const start = new Date("2026-06-28T00:00:00Z");
const end = new Date("2026-09-28T00:00:00Z");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
  const isoDate = date.toISOString().slice(0, 10);
  const [count = 0, level = 0] = contributions[isoDate] ?? [];
  const cell = document.createElement("span");
  const contributionLabel = `${count} contribution${count === 1 ? "" : "s"}`;

  cell.className = "day";
  cell.dataset.level = level;
  cell.title = `${contributionLabel} on ${dateFormatter.format(date)}`;
  cell.setAttribute("role", "gridcell");
  cell.setAttribute("aria-label", cell.title);
  graph.append(cell);
}
