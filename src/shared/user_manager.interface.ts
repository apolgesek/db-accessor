export interface IUserManager<GetUserCtx = any, AssignPolicyCtx = any> {
  getUser(name: string, context?: GetUserCtx): Promise<string | undefined>;
  assignPolicy(userId: string, policy: string, context?: AssignPolicyCtx): Promise<string | undefined>;
}
