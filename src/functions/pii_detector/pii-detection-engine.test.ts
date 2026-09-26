import { DetectPiiRequest, PiiEntityType } from '../../shared/pii-detection';
import { isCreditCard } from './detectors/credit-card-detector';
import { isEmail } from './detectors/email-detector';
import { EntityDetector } from './detectors/entity-detector';
import { isIban } from './detectors/iban-detector';
import { isInternationalPhone } from './detectors/phone-detector';
import { PiiDetectionEngine } from './pii-detection-engine';

const detectionEngine = new PiiDetectionEngine();

function request(path: string, value: string | number = 'not pii'): DetectPiiRequest {
  return { version: 1, items: [{ id: 'item-1', path, value }] };
}

function detectionFor(path: string, value: string | number = 'not pii') {
  return detectionEngine.detect(request(path, value)).results[0].detections[0];
}

describe('PII detection engine path rules', () => {
  test.each<[string, PiiEntityType]>([
    ['first', 'PERSON'],
    ['firstName', 'PERSON'],
    ['given', 'PERSON'],
    ['givenName', 'PERSON'],
    ['middle', 'PERSON'],
    ['middleName', 'PERSON'],
    ['last', 'PERSON'],
    ['lastName', 'PERSON'],
    ['family', 'PERSON'],
    ['familyName', 'PERSON'],
    ['full', 'PERSON'],
    ['fullName', 'PERSON'],
    ['surname', 'PERSON'],
    ['email', 'EMAIL_ADDRESS'],
    ['emailAddress', 'EMAIL_ADDRESS'],
    ['phone', 'PHONE_NUMBER'],
    ['phoneNumber', 'PHONE_NUMBER'],
    ['mobile', 'PHONE_NUMBER'],
    ['mobileNumber', 'PHONE_NUMBER'],
    ['telephone', 'PHONE_NUMBER'],
    ['telephoneNumber', 'PHONE_NUMBER'],
    ['dateOfBirth', 'DATE_OF_BIRTH'],
    ['birthDate', 'DATE_OF_BIRTH'],
    ['dob', 'DATE_OF_BIRTH'],
    ['addressLine', 'ADDRESS'],
    ['addressLine1', 'ADDRESS'],
    ['addressLine2', 'ADDRESS'],
    ['address1', 'ADDRESS'],
    ['address2', 'ADDRESS'],
    ['streetAddress', 'ADDRESS'],
    ['postalCode', 'POSTAL_CODE'],
    ['postcode', 'POSTAL_CODE'],
    ['zip', 'POSTAL_CODE'],
    ['zipCode', 'POSTAL_CODE'],
    ['creditCard', 'CREDIT_CARD'],
    ['creditCardNumber', 'CREDIT_CARD'],
    ['paymentCard', 'CREDIT_CARD'],
    ['paymentCardNumber', 'CREDIT_CARD'],
    ['iban', 'IBAN_CODE'],
    ['ibanCode', 'IBAN_CODE'],
    ['ipAddress', 'IP_ADDRESS'],
    ['ipv4', 'IP_ADDRESS'],
    ['ipv4Address', 'IP_ADDRESS'],
    ['ipv6', 'IP_ADDRESS'],
    ['ipv6Address', 'IP_ADDRESS'],
  ])('classifies the %s alias', (alias, entityType) => {
    expect(detectionFor(`profile.${alias}`)).toMatchObject({ entityType, confidence: 0.9 });
  });

  test.each<[string, PiiEntityType]>([
    ['name', 'PERSON'],
    ['address', 'ADDRESS'],
    ['cardNumber', 'CREDIT_CARD'],
    ['ip', 'IP_ADDRESS'],
  ])('uses lower confidence for ambiguous alias %s', (alias, entityType) => {
    expect(detectionFor(alias)).toMatchObject({ entityType, confidence: 0.65 });
  });

  test('normalizes case, whitespace, underscores, and hyphens in the final property', () => {
    expect(detectionFor('customer.GiVeN_- Name')).toMatchObject({ entityType: 'PERSON', confidence: 0.9 });
  });

  test.each(['contacts[].phone', 'orders[0].email', 'payments.*.cardNumber'])(
    'supports redactor syntax in %s',
    (path) => {
      expect(detectionEngine.detect(request(path)).results[0].status).toBe('DETECTED');
    },
  );

  test.each([
    '',
    '.email',
    'customer.',
    'customer..email',
    '$.customer.email',
    'orders[-1].email',
    'orders[abc].email',
  ])('returns UNSUPPORTED_PATH for %j', (path) => {
    expect(detectionEngine.detect(request(path, 'person@example.com')).results[0]).toEqual({
      id: 'item-1',
      path,
      status: 'UNSUPPORTED_PATH',
      detections: [],
    });
  });
});

describe('PII detector value validators', () => {
  test.each(['person@example.com', "customer.o'hare+tag@example.co.uk"])('recognizes valid email %s', (value) =>
    expect(isEmail(` ${value} `)).toBe(true),
  );

  test.each(['person@example', 'a..b@example.com', 'person @example.com', '@example.com'])(
    'rejects invalid email %s',
    (value) => expect(isEmail(value)).toBe(false),
  );

  test('recognizes only valid international phone numbers', () => {
    expect(isInternationalPhone('+44 20 7946 0018')).toBe(true);
    expect(isInternationalPhone('020 7946 0018')).toBe(false);
    expect(isInternationalPhone('+123')).toBe(false);
  });

  test.each(['4111111111111111', '4111-1111-1111-1111', '378282246310005'])(
    'recognizes Luhn-valid card number %s',
    (value) => expect(isCreditCard(value)).toBe(true),
  );

  test.each(['4111111111111112', '41111111111', '4111x11111111111'])('rejects invalid card number %s', (value) =>
    expect(isCreditCard(value)).toBe(false),
  );

  test.each([
    'GB82 WEST 1234 5698 7654 32',
    'DE89370400440532013000',
    'PL61109010140000071219812874',
    'BI4210000100010000332045181',
    'DJ2110002010010409943020008',
    'FK12SC987654321098',
    'HN54PISA00000000000000123124',
    'LY83002048000020100120361',
    'MN121234123456789123',
    'NI45BAPR00000013000003558124',
    'RU0304452522540817810538091310419',
    'SD2129010501234001',
    'SO211000001001000100141',
    'YE15CBYE0001018861234567891234',
  ])('recognizes valid IBAN %s', (value) => expect(isIban(value)).toBe(true));

  test.each(['GB82WEST12345698765431', 'GB82WEST1234', 'ZZ82WEST12345698765432'])('rejects invalid IBAN %s', (value) =>
    expect(isIban(value)).toBe(false),
  );

  test.each<[string, PiiEntityType]>([
    ['person@example.com', 'EMAIL_ADDRESS'],
    ['+44 20 7946 0018', 'PHONE_NUMBER'],
    ['2001:db8::1', 'IP_ADDRESS'],
    ['192.0.2.10', 'IP_ADDRESS'],
    ['4111111111111111', 'CREDIT_CARD'],
    ['GB82 WEST 1234 5698 7654 32', 'IBAN_CODE'],
  ])('detects %s based on value', (value, entityType) => {
    expect(detectionFor('metadata.value', value)).toMatchObject({ entityType });
  });

  test.each(['2020-01-01', '550e8400-e29b-41d4-a716-446655440000', '123456789', 'generic-id-123'])(
    'does not infer unsupported value shape %s',
    (value) => expect(detectionEngine.detect(request('metadata.value', value)).results[0].status).toBe('NOT_DETECTED'),
  );

  test('does not apply value validators to numeric values', () => {
    expect(detectionEngine.detect(request('metadata.value', 4111111111111111)).results[0].status).toBe('NOT_DETECTED');
    expect(detectionFor('payment.cardNumber', 4111111111111111)).toMatchObject({
      entityType: 'CREDIT_CARD',
      confidence: 0.65,
      evidence: [{ source: 'PATH_RULE' }],
    });
  });
});

describe('PII detector response behavior', () => {
  test('normalizes observations and merges evidence from injected detectors', () => {
    const firstDetector: EntityDetector = {
      entityType: 'EMAIL_ADDRESS',
      detect: jest.fn().mockReturnValue([{ source: 'PATH_RULE', ruleId: 'FIRST', confidence: 0.65 }]),
    };
    const secondDetector: EntityDetector = {
      entityType: 'EMAIL_ADDRESS',
      detect: jest.fn().mockReturnValue([{ source: 'VALUE_VALIDATOR', ruleId: 'SECOND', confidence: 0.99 }]),
    };
    const engine = new PiiDetectionEngine([firstDetector, secondDetector]);

    const result = engine.detect(request('profile.Email_- Address', 'person@example.com')).results[0];

    expect(firstDetector.detect).toHaveBeenCalledWith({
      normalizedProperty: 'emailaddress',
      value: 'person@example.com',
    });
    expect(result.detections).toEqual([
      {
        entityType: 'EMAIL_ADDRESS',
        confidence: 0.99,
        evidence: [
          { source: 'PATH_RULE', ruleId: 'FIRST', confidence: 0.65 },
          { source: 'VALUE_VALIDATOR', ruleId: 'SECOND', confidence: 0.99 },
        ],
      },
    ]);
  });

  test('merges path and value evidence of the same type at the highest confidence', () => {
    expect(detectionFor('customer.email', 'person@example.com')).toEqual({
      entityType: 'EMAIL_ADDRESS',
      confidence: 0.99,
      evidence: [
        { source: 'PATH_RULE', ruleId: 'PATH_ALIAS_EMAIL', confidence: 0.9 },
        { source: 'VALUE_VALIDATOR', ruleId: 'VALUE_EMAIL_FORMAT', confidence: 0.99 },
      ],
    });
  });

  test('allows overlapping types and sorts by confidence then entity type', () => {
    const result = detectionEngine.detect(request('customer.email', '+44 20 7946 0018')).results[0];
    expect(result.detections.map(({ entityType, confidence }) => ({ entityType, confidence }))).toEqual([
      { entityType: 'PHONE_NUMBER', confidence: 0.95 },
      { entityType: 'EMAIL_ADDRESS', confidence: 0.9 },
    ]);
  });

  test('preserves input order, path text, repeated paths, distinct IDs, and negative results', () => {
    const response = detectionEngine.detect({
      version: 1,
      items: [
        { id: 'a', path: ' profile.email ', value: 'not an email' },
        { id: 'b', path: 'profile.email', value: 'also not an email' },
        { id: 'c', path: 'profile.note', value: 'ordinary value' },
      ],
    });

    expect(response.results.map(({ id, path, status }) => ({ id, path, status }))).toEqual([
      { id: 'a', path: ' profile.email ', status: 'DETECTED' },
      { id: 'b', path: 'profile.email', status: 'DETECTED' },
      { id: 'c', path: 'profile.note', status: 'NOT_DETECTED' },
    ]);
    expect(JSON.stringify(response)).not.toContain('ordinary value');
    expect(response.results).toHaveLength(3);
  });
});
