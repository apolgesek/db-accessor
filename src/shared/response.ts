import { APIGatewayProxyResult } from "aws-lambda";

const CORS_HEADER = { "Access-Control-Allow-Origin": "*" };

class Response {
  static success<T>(data: T): APIGatewayProxyResult;
  static success(message: string): APIGatewayProxyResult;
  static success<T>(dataOrMessage: T | string): APIGatewayProxyResult {
    return {
      statusCode: 200,
      headers: CORS_HEADER,
      body: JSON.stringify(
        typeof dataOrMessage === "string"
          ? { message: dataOrMessage }
          : dataOrMessage
      ),
    };
  }

  static error(statusCode: number, message: string): APIGatewayProxyResult {
    return {
      statusCode,
      headers: CORS_HEADER,
      body: JSON.stringify({ message }),
    };
  }
}

export { Response };
