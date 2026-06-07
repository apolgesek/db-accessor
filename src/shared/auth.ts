export function getGroups(claims: { ['cognito:groups']?: unknown }): string[] {
  const rawGroups = claims['cognito:groups'];
  return Array.isArray(rawGroups) ? rawGroups : typeof rawGroups === 'string' ? rawGroups.split(',') : [];
}

export function isAdmin(claims: { ['cognito:groups']?: unknown }): boolean {
  return getGroups(claims).includes('ADMIN');
}
