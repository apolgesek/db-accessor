import { APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADER = { 'Access-Control-Allow-Origin': '*' };

export class APIResponse {
  static success<T>(statusCode: number, data?: T): APIGatewayProxyResult;
  static success(statusCode: number, message?: string): APIGatewayProxyResult;
  static success<T>(statusCode: number, dataOrMessage?: T | string): APIGatewayProxyResult {
    return {
      statusCode,
      headers: CORS_HEADER,
      body: JSON.stringify(typeof dataOrMessage === 'string' ? { message: dataOrMessage } : dataOrMessage),
    };
  }

  static error(statusCode: number, message?: string): APIGatewayProxyResult {
    return {
      statusCode,
      headers: CORS_HEADER,
      body: message ? JSON.stringify({ message }) : '',
    };
  }
}
