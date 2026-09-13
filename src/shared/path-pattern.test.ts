import { getFinalPropertyToken, tokenizePath } from './path-pattern';

describe('path pattern utilities', () => {
  test.each([
    ['customer.email', ['customer', 'email']],
    ['contacts[].phone', ['contacts', '[]', 'phone']],
    ['orders[0].email', ['orders', '[0]', 'email']],
    ['payments.*.cardNumber', ['payments', '*', 'cardNumber']],
    ['[0].email', ['[0]', 'email']],
  ])('tokenizes %s', (path, expected) => {
    expect(tokenizePath(path)).toEqual(expected);
  });

  test.each([
    '',
    '.email',
    'customer.',
    'customer..email',
    '$.customer.email',
    'orders[-1].email',
    'orders[x].email',
    'a[b]',
  ])('rejects malformed path %j', (path) => {
    expect(tokenizePath(path)).toBeUndefined();
  });

  test('returns the final meaningful property around selectors and wildcards', () => {
    expect(getFinalPropertyToken(tokenizePath('payments.*.cardNumber[]') ?? [])).toBe('cardNumber');
    expect(getFinalPropertyToken(tokenizePath('[]') ?? [])).toBeUndefined();
  });
});
