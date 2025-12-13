export type IAMAssignPolicyContext = {
  tableName: string;
  partitionKey: string;
  expirationDate: Date;
};
