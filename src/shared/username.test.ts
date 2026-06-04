import { getUsernamePrefix, toAppUsername, toCognitoUsername } from './username';

describe('username helpers', () => {
  const originalUsernamePrefix = process.env.USERNAME_PREFIX;

  afterEach(() => {
    if (originalUsernamePrefix === undefined) {
      delete process.env.USERNAME_PREFIX;
    } else {
      process.env.USERNAME_PREFIX = originalUsernamePrefix;
    }
  });

  test('removes configured Cognito username prefix for app username', () => {
    expect(toAppUsername('custom_user-1', 'custom_')).toBe('user-1');
  });

  test('adds configured Cognito username prefix for Cognito username', () => {
    expect(toCognitoUsername('user-1', 'custom_')).toBe('custom_user-1');
  });

  test('does not duplicate configured Cognito username prefix', () => {
    expect(toCognitoUsername('custom_user-1', 'custom_')).toBe('custom_user-1');
  });

  test('requires username prefix configuration when not injected', () => {
    delete process.env.USERNAME_PREFIX;

    expect(() => getUsernamePrefix()).toThrow('USERNAME_PREFIX environment variable is required');
  });
});
