import {
  getRateLimitRetryDelaySeconds,
  getRetryDelaySeconds,
  parseRetryAfterSeconds,
  RateLimitError,
} from './retry.util';

describe('retry utilities', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('computes exponential retry delay with cap', () => {
    expect(getRetryDelaySeconds(1)).toBe(30);
    expect(getRetryDelaySeconds(2)).toBe(60);
    expect(getRetryDelaySeconds(7)).toBe(1_800);
    expect(getRetryDelaySeconds(20)).toBe(1_800);
  });

  test('computes rate limit retry delay with jitter and Retry-After minimum', () => {
    expect(getRateLimitRetryDelaySeconds(1, undefined, 0.5)).toBe(30);
    expect(getRateLimitRetryDelaySeconds(2, undefined, 0.5)).toBe(60);
    expect(getRateLimitRetryDelaySeconds(2, 20, 0)).toBe(42);
    expect(getRateLimitRetryDelaySeconds(2, 45, 0)).toBe(45);
    expect(getRateLimitRetryDelaySeconds(20, 3_600, 0.5)).toBe(3_600);
  });

  test('parses Retry-After seconds', () => {
    expect(parseRetryAfterSeconds('2')).toBe(2);
    expect(parseRetryAfterSeconds('0')).toBeUndefined();
    expect(parseRetryAfterSeconds('invalid')).toBeUndefined();
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
  });

  test('carries retry-after seconds on rate limit errors', () => {
    const error = new RateLimitError('Rate limited', 12);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RateLimitError');
    expect(error.retryAfterSeconds).toBe(12);
  });
});
