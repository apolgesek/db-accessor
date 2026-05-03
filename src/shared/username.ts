const DEFAULT_USERNAME_PREFIX = 'db-accessor_';

export function getUsernamePrefix(): string {
  return process.env.USERNAME_PREFIX ?? DEFAULT_USERNAME_PREFIX;
}

export function toAppUsername(cognitoUsername: string, usernamePrefix = getUsernamePrefix()): string {
  return cognitoUsername.startsWith(usernamePrefix) ? cognitoUsername.slice(usernamePrefix.length) : cognitoUsername;
}

export function toCognitoUsername(appUsername: string, usernamePrefix = getUsernamePrefix()): string {
  return appUsername.startsWith(usernamePrefix) ? appUsername : `${usernamePrefix}${appUsername}`;
}
