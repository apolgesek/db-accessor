import * as fs from 'fs';
import * as path from 'path';
import { REST_PREFLIGHT_METHODS, REST_ROUTES } from './rest-routes';

describe('REST route table', () => {
  test('lists each method and path once', () => {
    const keys = REST_ROUTES.map((route) => `${route.method} ${route.path}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test('points every route at an existing Lambda entrypoint', () => {
    for (const route of REST_ROUTES) {
      const entry = path.join(__dirname, '..', 'functions', route.functionName.replace(/-/g, '_'), 'main.ts');

      expect(fs.existsSync(entry)).toBe(true);
    }
  });

  test('allows every routed method in its path preflight', () => {
    for (const route of REST_ROUTES) {
      expect(REST_PREFLIGHT_METHODS[route.path]).toEqual(expect.arrayContaining(['OPTIONS', route.method]));
    }
  });

  test('declares preflight only for routed paths', () => {
    const routedPaths = new Set<string>(REST_ROUTES.map((route) => route.path));

    expect(Object.keys(REST_PREFLIGHT_METHODS).filter((routePath) => !routedPaths.has(routePath))).toEqual([]);
  });

  test('puts every existing business route under the session policy', () => {
    expect(REST_ROUTES.filter((route) => route.policy !== 'session')).toEqual([]);
  });
});
