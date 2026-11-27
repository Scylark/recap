/** date_trunc in the browser's time zone, matching the p_tz the dashboard sends to the database. */
export function trunc(ms: number, interval: string): number {
  const d = new Date(ms);
  if (interval === 'hour') d.setMinutes(0, 0, 0);
  else {
    d.setHours(0, 0, 0, 0);
    if (interval === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (interval === 'month') d.setDate(1);
  }
  return d.getTime();
}

/** Every bucket start from `since` to now, so empty periods show as zero. */
export function buckets(since: string, interval: string, now = Date.now()): number[] {
  const out: number[] = [];
  let t = trunc(Date.parse(since), interval);
  const end = trunc(now, interval);
  for (let guard = 0; t <= end && guard < 2000; guard++) {
    out.push(t);
    const d = new Date(t);
    if (interval === 'hour') d.setHours(d.getHours() + 1);
    else if (interval === 'day') d.setDate(d.getDate() + 1);
    else if (interval === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    t = trunc(d.getTime(), interval);
  }
  return out;
}

export function bucketLabel(ms: number, interval: string): string {
  const d = new Date(ms);
  if (interval === 'hour') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (interval === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
