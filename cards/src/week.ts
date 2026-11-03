// THIS WEEK: the arcade's one leaderboard window, Friday 23:00 Lisbon to the next Friday 23:00 Lisbon, one closing for
// every game, computed in the page (no redeploy per week). Week 1 ran from Thursday 22 October 2026 00:00 to Friday 30 October
// 15:00 Lisbon, week 2 from there to Friday 6 November 23:00. Lisbon is UTC+1 in summer and UTC+0 in winter: the bounds are computed from Lisbon wall
// time, then sent to Studio as UTC instants (`getServerLeaderboard({ from, to })` reads `[from, to)`).
// Identical copy of src/shell/week.ts (the games), pinned by the same test vectors (tests/week.test.ts).
const ZONE = 'Europe/Lisbon';
const DAY_MS = 86_400_000;

/** Lisbon wall-clock fields of an instant. */
function lisbonParts(instant: number): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const y = get('year'), m = get('month'), d = get('day');
  return { y, m, d, hh: get('hour'), mm: get('minute'), weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** The UTC instant of a Lisbon wall-clock time (two passes settle the offset across a DST change). */
function lisbonToUtc(y: number, m: number, d: number, hh: number): number {
  const wall = Date.UTC(y, m - 1, d, hh);
  let guess = wall;
  for (let pass = 0; pass < 2; pass++) {
    const p = lisbonParts(guess);
    const asWall = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += wall - asWall;
  }
  return guess;
}

export type Week = { from: string; to: string };

/** Week 1: Thursday 22 October 2026 00:00 Lisbon (still summer time) to Friday 30 October 15:00 (winter time). Week 2: to Friday 6 November 23:00. */
const FIRST_FROM = lisbonToUtc(2026, 10, 22, 0), FIRST_TO = lisbonToUtc(2026, 10, 30, 15), SECOND_TO = lisbonToUtc(2026, 11, 6, 23);
const iso = (t: number): string => new Date(t).toISOString();

/** The week that contains `now`: weeks 1 and 2 until they close (week 1 before it opens too), then from the latest Friday
 *  23:00 Lisbon at or before `now`, to seven days later. */
export function lisbonWeek(now: number = Date.now()): Week {
  if (now < FIRST_TO) return { from: iso(FIRST_FROM), to: iso(FIRST_TO) };
  if (now < SECOND_TO) return { from: iso(FIRST_TO), to: iso(SECOND_TO) };
  const p = lisbonParts(now);
  const back = (p.weekday - 5 + 7) % 7;                                   // days since Friday (Lisbon calendar)
  const friday = new Date(Date.UTC(p.y, p.m - 1, p.d) - back * DAY_MS);
  let from = lisbonToUtc(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate(), 23);
  if (from > now) {                                                       // Friday before 23:00: still last week
    const previous = new Date(friday.getTime() - 7 * DAY_MS);
    from = lisbonToUtc(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate(), 23);
  }
  const start = lisbonParts(from);
  const next = new Date(Date.UTC(start.y, start.m - 1, start.d) + 7 * DAY_MS);
  const to = lisbonToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 23);
  return { from: iso(from), to: iso(to) };
}

export const WEEK_LABEL = 'This week';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The real end of a week, in Lisbon time: "ends Fri Nov 6 · 23:00 Lisbon". */
export function weekEnds(week: Week): string {
  const p = lisbonParts(Date.parse(week.to));
  return `ends ${DAYS[p.weekday]} ${MONTHS[p.m - 1]} ${p.d} · ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')} Lisbon`;
}
