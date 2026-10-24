import { APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADER = { 'Access-Control-Allow-Origin': '*' };

export type APIResponseOptions = { headers?: Record<string, string> };

export type APIErrorOptions = APIResponseOptions & { code?: string }; // machine-readable, sent beside `message`

export class APIResponse {
  static success<T>(statusCode: number, data?: T, options?: APIResponseOptions): APIGatewayProxyResult;
  static success(statusCode: number, message?: string, options?: APIResponseOptions): APIGatewayProxyResult;
  static success<T>(
    statusCode: number,
    dataOrMessage?: T | string,
    options?: APIResponseOptions,
  ): APIGatewayProxyResult {
    return {
      statusCode,
      headers: { ...CORS_HEADER, ...options?.headers },
      body: JSON.stringify(typeof dataOrMessage === 'string' ? { message: dataOrMessage } : dataOrMessage),
    };
  }

  static error(statusCode: number, message?: string, options?: APIErrorOptions): APIGatewayProxyResult {
    return {
      statusCode,
      headers: { ...CORS_HEADER, ...options?.headers },
      body: message ? JSON.stringify(options?.code ? { message, code: options.code } : { message }) : '',
    };
  }
}
