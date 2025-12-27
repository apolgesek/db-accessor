// path-pattern-redactor.spec.ts
import { PathPatternRedactor, DEFAULT_REDACTION } from './redactor';

describe('PathPatternRedactor', () => {
  test('redacts array wildcard []: contacts[].email', () => {
    const redactor = new PathPatternRedactor(['contacts[].email']);

    const input = {
      contacts: [
        { email: 'a@a.com', phone: '111' },
        { email: 'b@b.com', phone: '222' },
      ],
    };

    const out = redactor.redact(input);

    expect(out).toEqual({
      contacts: [
        { email: DEFAULT_REDACTION, phone: '111' },
        { email: DEFAULT_REDACTION, phone: '222' },
      ],
    });

    // default is non-mutating
    expect(input.contacts[0].email).toBe('a@a.com');
  });

  test('redacts object wildcard *: payments.*.cardNumber', () => {
    const redactor = new PathPatternRedactor(['payments.*.cardNumber']);

    const input = {
      payments: {
        visa: { cardNumber: '4111', expiry: '12/30' },
        amex: { cardNumber: '3782', expiry: '11/29' },
      },
    };

    const out = redactor.redact(input);

    expect(out).toEqual({
      payments: {
        visa: { cardNumber: DEFAULT_REDACTION, expiry: '12/30' },
        amex: { cardNumber: DEFAULT_REDACTION, expiry: '11/29' },
      },
    });
  });

  test('redacts explicit array index: orders[0].customer.email', () => {
    const redactor = new PathPatternRedactor(['orders[0].customer.email']);

    const input = {
      orders: [
        { customer: { email: 'first@x.com', name: 'First' } },
        { customer: { email: 'second@x.com', name: 'Second' } },
      ],
    };

    const out = redactor.redact(input);

    expect(out).toEqual({
      orders: [
        { customer: { email: DEFAULT_REDACTION, name: 'First' } },
        { customer: { email: 'second@x.com', name: 'Second' } },
      ],
    });
  });

  test('supports multiple patterns at once', () => {
    const redactor = new PathPatternRedactor(['contacts[].email', 'payments.*.cardNumber', 'orders[0].customer.email']);

    const input = {
      contacts: [{ email: 'a@a.com' }],
      payments: { visa: { cardNumber: '4111', expiry: '12/30' } },
      orders: [{ customer: { email: 'first@x.com' } }, { customer: { email: 'second@x.com' } }],
    };

    const out = redactor.redact(input);

    expect(out.contacts[0].email).toBe(DEFAULT_REDACTION);
    expect(out.payments.visa.cardNumber).toBe(DEFAULT_REDACTION);
    expect(out.payments.visa.expiry).toBe('12/30');
    expect(out.orders[0].customer.email).toBe(DEFAULT_REDACTION);
    expect(out.orders[1].customer.email).toBe('second@x.com');
  });

  test('does not touch unrelated branches (skips traversal when no active patterns)', () => {
    const redactor = new PathPatternRedactor(['a.b.c']);

    const input = {
      a: { b: { c: 'secret', d: 'keep' } },
      huge: {
        deep: { nested: { object: { with: { many: { nodes: 1 } } } } },
      },
    };

    const out = redactor.redact(input);

    expect(out).toEqual({
      a: { b: { c: DEFAULT_REDACTION, d: 'keep' } },
      huge: input.huge,
    });
  });

  test('mutate=true mutates the original object', () => {
    const redactor = new PathPatternRedactor(['a.b']);

    const input: any = { a: { b: 'secret', c: 'ok' } };
    const out = redactor.redact(input, { mutate: true });

    expect(out).toBe(input); // same reference
    expect(input.a.b).toBe(DEFAULT_REDACTION);
    expect(input.a.c).toBe('ok');
  });

  test('custom redaction text', () => {
    const redactor = new PathPatternRedactor(['a.b'], '[X]');

    const input = { a: { b: 'secret' } };
    const out = redactor.redact(input);

    expect(out.a.b).toBe('[X]');
  });

  test('handles null / primitives safely', () => {
    const redactor = new PathPatternRedactor(['a.b']);

    expect(redactor.redact(null as any)).toBeNull();
    expect(redactor.redact(123 as any)).toBe(123);

    const out = redactor.redact({ a: null });
    expect(out).toEqual({ a: null });
  });

  test('avoids infinite recursion on circular references', () => {
    const redactor = new PathPatternRedactor(['self.secret']);

    const obj: any = { self: {} };
    obj.self.secret = 'top';
    obj.self.loop = obj; // cycle back

    const out = redactor.redact(obj);

    expect(out.self.secret).toBe(DEFAULT_REDACTION);
    expect(out.self.loop).toBe(out); // cycle preserved (clone keeps it, and seen prevents recursion blowup)
  });

  test('dedupes active nodes when exact and wildcard converge (no double-walk issues)', () => {
    // Both patterns match the same ultimate field; without dedupe you'd get duplicate active nodes.
    const redactor = new PathPatternRedactor(['a.*.c', 'a.b.c']);

    const input = { a: { b: { c: 'secret', d: 'ok' } } };
    const out = redactor.redact(input);

    expect(out.a.b.c).toBe(DEFAULT_REDACTION);
    expect(out.a.b.d).toBe('ok');
  });
});
