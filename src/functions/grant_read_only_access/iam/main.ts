import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { IAMUserRepository } from '../../../shared/iam_user_repository';
import { APIResponse } from '../../../shared/response';
import { createPolicy } from '../dynamodb_policy';
import { validate } from '../request_validator';

class LambdaHandler {
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const awsAccountId = context.invokedFunctionArn.split(':')[4];
    const body = event.body ? JSON.parse(event.body) : {};
    const userName: string = body.userName;
    const tableName: string = body.tableName;
    const partitionKey: string = body.partitionKey;
    const duration: string | number = body.duration;

    const result = validate(event);
    if (result && result?.statusCode >= 400) {
      return result;
    }

    const iamUserRepository = new IAMUserRepository();

    const userId = await iamUserRepository.getUser(userName);
    if (!userId) return APIResponse.error(404, `IAM user ${userName} not found`);

    const durationHours = duration ? Math.min(Math.max(Number(duration), 1), 24) : 1;
    const currentDate = new Date();
    const expirationDate = new Date(currentDate.getTime() + durationHours * 3_600 * 1_000);

    const inlinePolicy = createPolicy({
      awsAccountId,
      tableName,
      partitionKey,
      currentDate,
      expirationDate,
    });

    const requestId = await iamUserRepository.assignPolicy(userName, inlinePolicy, {
      tableName,
      partitionKey,
      expirationDate,
    });
    if (!requestId) throw new Error('Missing RequestId from AttachUserPolicy.');

    const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    const params = {
      TableName: process.env.AUDIT_LOGS_TABLE_NAME,
      Item: {
        UserId: { S: 'iam_user' },
        CreatedAt: { N: currentDate.getTime().toString() },
      },
    };

    await dynamoDbClient.send(new PutItemCommand(params));

    return APIResponse.success(
      `Readonly access granted for user ${userName}, table ${tableName}, item pK: ${partitionKey}, duration: ${durationHours} hour(s)`,
    );
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
