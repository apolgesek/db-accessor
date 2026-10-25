import * as fs from 'fs';
import * as path from 'path';
import { lambdaFolderName } from './lambda-name';
import { REST_PREFLIGHT_METHODS, REST_ROUTES } from './rest-routes';

describe('REST route table', () => {
  test('lists each method and path once', () => {
    const keys = REST_ROUTES.map((route) => `${route.method} ${route.path}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test('points every route at an existing Lambda entrypoint', () => {
    for (const route of REST_ROUTES) {
      const entry = path.join(__dirname, '..', 'functions', lambdaFolderName(route.functionName), 'main.ts');

      expect(fs.existsSync(entry)).toBe(true);
    }
  });

  test('allows every routed method in its path preflight, including overridden paths', () => {
    for (const route of REST_ROUTES) {
      expect(REST_PREFLIGHT_METHODS.get(route.path)).toEqual(expect.arrayContaining(['OPTIONS', route.method]));
    }
  });

  test('derives preflight as OPTIONS followed by the path methods in table order', () => {
    expect(REST_PREFLIGHT_METHODS.get('/request')).toEqual(['OPTIONS', 'POST', 'GET']);
    expect(REST_PREFLIGHT_METHODS.get('/admin/configured-tables')).toEqual(['OPTIONS', 'POST', 'DELETE']);
    expect(REST_PREFLIGHT_METHODS.get('/tables')).toEqual(['OPTIONS', 'GET']);
  });

  test('exempts only the session routes from the session policy', () => {
    const lifecycleRoutes = REST_ROUTES.filter((route) => route.policy === 'sessionLifecycle');

    expect(lifecycleRoutes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'POST /session',
      'GET /session',
      'POST /session/activity',
    ]);
  });
});
