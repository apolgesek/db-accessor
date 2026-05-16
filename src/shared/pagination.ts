import { AttributeValue } from '@aws-sdk/client-dynamodb';

export type PaginationCursor = Record<string, AttributeValue>;

export function encodePaginationCursor(cursor: PaginationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePaginationCursor(cursor: string): PaginationCursor | undefined {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as PaginationCursor;
  } catch {
    return undefined;
  }
}
