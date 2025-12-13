import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { APIResponse } from '../../shared/response';

export function validate(event: APIGatewayProxyEvent): APIGatewayProxyResult | undefined {
  const body = event.body ? JSON.parse(event.body) : {};
  const userName: string = body.userName;
  const tableName: string = body.tableName;
  const partitionKey: string = body.partitionKey;
  const duration: string | number = body.duration;

  if (!userName || !tableName || !partitionKey || !duration) {
    return APIResponse.error(400, 'Missing required fields');
  }

  if (!duration.toString().match(/^[1-9][0-9]{0,1}$/)) {
    return APIResponse.error(400, 'Invalid duration format');
  }
}
