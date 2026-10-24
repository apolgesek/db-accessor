import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handleSessionOperation } from '../../shared/session-http';
import { createSessionService, SessionService } from '../../shared/session-service';

// POST /session: establish or return the browser login session for the token's lineage. Never extends.
export class LambdaHandler {
  constructor(private readonly sessionService: SessionService) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    return handleSessionOperation('establish', event, (claims) => this.sessionService.establish(claims), {
      logSuccess: true,
    });
  }
}

const handlerInstance = new LambdaHandler(createSessionService());
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
