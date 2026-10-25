import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handleSessionOperation } from '../../shared/session-http';
import { createSessionService, SessionService } from '../../shared/session-service';

// POST /session/activity: qualifying activity extends the browser login session while it is still active.
// Accepted reports are frequent and routine, so only rejections and failures are logged.
export class LambdaHandler {
  constructor(private readonly sessionService: SessionService) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    return handleSessionOperation('recordActivity', event, (claims) => this.sessionService.recordActivity(claims), {
      logSuccess: false,
    });
  }
}

const handlerInstance = new LambdaHandler(createSessionService());
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
