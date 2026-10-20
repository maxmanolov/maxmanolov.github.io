// Fetches the last 14 weeks of GitHub contributions for the site's graph and
// writes them to contributions.json. Run by the update-contributions workflow.
import { writeFileSync } from "node:fs";

const LOGIN = "maxmanolov";
const WEEKS = 14;
const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is not set");

// The graph's columns are Sunday-to-Saturday weeks ending with the current one.
const now = new Date();
const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
from.setUTCDate(from.getUTCDate() - from.getUTCDay() - (WEEKS - 1) * 7);

const query = `query ($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { login: LOGIN, from: from.toISOString(), to: now.toISOString() } }),
});
const result = await response.json();
if (!response.ok || result.errors) throw new Error(JSON.stringify(result.errors ?? result));

const calendar = result.data.user.contributionsCollection.contributionCalendar;
const days = calendar.weeks
  .flatMap((week) => week.contributionDays)
  .map((day) => [day.date, day.contributionCount, LEVELS[day.contributionLevel] ?? 0]);

const data = { total: calendar.totalContributions, days };
writeFileSync("contributions.json", `${JSON.stringify(data)}\n`);
console.log(`Wrote ${days.length} days, ${data.total} contributions since ${days[0][0]}`);
