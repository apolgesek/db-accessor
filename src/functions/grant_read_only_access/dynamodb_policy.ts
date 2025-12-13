export type PolicyContext = {
  awsAccountId: string;
  tableName: string;
  partitionKey: string;
  currentDate: Date;
  expirationDate: Date;
};

export function createPolicy(context: PolicyContext) {
  return JSON.stringify({
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
        Resource: `arn:aws:dynamodb:${process.env.AWS_REGION}:${context.awsAccountId}:table/${context.tableName}`,
      },
      {
        Effect: 'Allow',
        Action: ['dynamodb:GetItem', 'dynamodb:Query'],
        Resource: `arn:aws:dynamodb:${process.env.AWS_REGION}:${context.awsAccountId}:table/${context.tableName}`,
        Condition: {
          'ForAllValues:StringEquals': {
            'dynamodb:LeadingKeys': [`${context.partitionKey}`],
          },
          DateGreaterThan: { 'aws:CurrentTime': context.currentDate.toISOString() },
          DateLessThan: { 'aws:CurrentTime': context.expirationDate.toISOString() },
        },
      },
    ],
  });
}
