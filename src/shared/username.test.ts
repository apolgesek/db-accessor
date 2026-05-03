import { toAppUsername, toCognitoUsername } from './username';

describe('username helpers', () => {
  test('removes configured Cognito username prefix for app username', () => {
    expect(toAppUsername('custom_user-1', 'custom_')).toBe('user-1');
  });

  test('adds configured Cognito username prefix for Cognito username', () => {
    expect(toCognitoUsername('user-1', 'custom_')).toBe('custom_user-1');
  });

  test('does not duplicate configured Cognito username prefix', () => {
    expect(toCognitoUsername('custom_user-1', 'custom_')).toBe('custom_user-1');
  });
});
