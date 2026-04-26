export function getTimeBucket(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}
