import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import {
  AttachUserPolicyCommand,
  CreatePolicyCommand,
  CreatePolicyCommandInput,
  GetUserCommand,
  IAMClient,
} from '@aws-sdk/client-iam';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Response } from '../../shared/response';

class LambdaHandler {
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const awsAccountId = context.invokedFunctionArn.split(':')[4];
    const iamClient = new IAMClient({ region: process.env.AWS_REGION });

    const body = event.body ? JSON.parse(event.body) : {};
    const iamUserName: string = body.userName;
    const tableName: string = body.tableName;
    const partitionKey: string = body.partitionKey;
    const duration: string | number = body.duration;

    if (!iamUserName || !tableName || !partitionKey || !duration) {
      return Response.error(400, 'Missing required fields');
    }

    if (!duration.toString().match(/^[1-9][0-9]{0,1}$/)) {
      return Response.error(400, 'Invalid duration format');
    }

    try {
      await iamClient.send(
        new GetUserCommand({
          UserName: iamUserName,
        }),
      );
    } catch (error) {
      console.error('Error fetching IAM user:', error);
      return Response.error(404, `IAM user ${iamUserName} not found`);
    }

    const durationHours = duration ? Math.min(Math.max(Number(duration), 1), 24) : 1;
    const currentDate = new Date();
    const expirationDate = new Date(currentDate.getTime() + durationHours * 3_600 * 1_000);

    const createPolicyParams: CreatePolicyCommandInput = {
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'dynamodb:ListTables',
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: 'dynamodb:DescribeTable',
            Resource: `arn:aws:dynamodb:${process.env.AWS_REGION}:${awsAccountId}:table/${tableName}`,
          },
          {
            Effect: 'Allow',
            Action: ['dynamodb:GetItem', 'dynamodb:Query'],
            Resource: `arn:aws:dynamodb:${process.env.AWS_REGION}:${awsAccountId}:table/${tableName}`,
            Condition: {
              'ForAllValues:StringEquals': {
                'dynamodb:LeadingKeys': [`${partitionKey}`],
              },
              DateGreaterThan: { 'aws:CurrentTime': currentDate.toISOString() },
              DateLessThan: { 'aws:CurrentTime': expirationDate.toISOString() },
            },
          },
        ],
      }),
      PolicyName: `dynamodb_GetItemPolicy_${iamUserName}_${tableName}_${partitionKey}`,
      Tags: [
        { Key: 'ExpiresAt', Value: expirationDate.getTime().toString() },
        { Key: 'UserName', Value: iamUserName },
      ],
    };

    const createPolicyOutput = await iamClient.send(new CreatePolicyCommand(createPolicyParams));
    await iamClient.send(
      new AttachUserPolicyCommand({
        PolicyArn: createPolicyOutput.Policy?.Arn,
        UserName: iamUserName,
      }),
    );

    const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    const params = {
      TableName: process.env.AUDIT_LOGS_TABLE_NAME,
      Item: {
        UserId: { S: 'iam_user' },
        CreatedAt: { N: currentDate.getTime().toString() },
      },
    };

    await dynamoDbClient.send(new PutItemCommand(params));

    return Response.success(
      `Readonly access granted for user ${iamUserName}, table ${tableName}, item pK: ${partitionKey}, duration: ${durationHours} hour(s)`,
    );
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
