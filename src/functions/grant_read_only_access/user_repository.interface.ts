export interface IUserRepository {
  getUser(name: string): Promise<any>;
}
