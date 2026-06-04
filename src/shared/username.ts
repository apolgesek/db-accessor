export function getUsernamePrefix(): string {
  const usernamePrefix = process.env.USERNAME_PREFIX;
  if (usernamePrefix === undefined) {
    throw new Error('USERNAME_PREFIX environment variable is required');
  }

  return usernamePrefix;
}

export function toAppUsername(cognitoUsername: string, usernamePrefix = getUsernamePrefix()): string {
  return cognitoUsername.startsWith(usernamePrefix) ? cognitoUsername.slice(usernamePrefix.length) : cognitoUsername;
}

export function toCognitoUsername(appUsername: string, usernamePrefix = getUsernamePrefix()): string {
  return appUsername.startsWith(usernamePrefix) ? appUsername : `${usernamePrefix}${appUsername}`;
}
