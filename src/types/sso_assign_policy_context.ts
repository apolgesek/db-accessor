export type SSOAssignPolicyContext = {
  identityStoreId: string;
  instanceArn: string;
  awsAccountId: string;
  userName: string;
  tableName: string;
  partitionKey: string;
  expirationDate: Date;
};
