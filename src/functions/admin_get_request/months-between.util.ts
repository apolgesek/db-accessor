export function monthsBetween(start: Date, end: Date): string[] {
  // ensure chronological order
  let a = start;
  let b = end;
  if (a.getTime() > b.getTime()) [a, b] = [b, a];

  const res: string[] = [];

  // normalize to first day of the month in local time
  let y = a.getFullYear();
  let m = a.getMonth(); // 0..11

  const endY = b.getFullYear();
  const endM = b.getMonth();

  while (y < endY || (y === endY && m <= endM)) {
    const mm = String(m + 1).padStart(2, '0');
    res.push(`${y}-${mm}`);

    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }

  return res;
}
