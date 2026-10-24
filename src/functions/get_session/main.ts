import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handleSessionOperation } from '../../shared/session-http';
import { createSessionService, SessionService } from '../../shared/session-service';

// GET /session: observe the browser login session for reconciliation. Never creates or extends.
export class LambdaHandler {
  constructor(private readonly sessionService: SessionService) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    return handleSessionOperation('observe', event, (claims) => this.sessionService.observe(claims), {
      logSuccess: false,
    });
  }
}

const handlerInstance = new LambdaHandler(createSessionService());
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
