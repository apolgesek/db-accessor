import { lambdaFolderName } from './lambda-name';

describe('lambdaFolderName', () => {
  test('maps a kebab-case Lambda name to its snake_case entrypoint folder', () => {
    expect(lambdaFolderName('admin-get-pii-suggestions')).toBe('admin_get_pii_suggestions');
  });
});
