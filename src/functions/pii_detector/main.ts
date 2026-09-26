import { DetectPiiResponse } from '../../shared/pii-detection';
import { PiiDetectionEngine } from './pii-detection-engine';
import { validateDetectPiiRequest } from './request-validator';

type DiagnosticLogger = {
  info(message: string, details: Record<string, number>): void;
};

export class LambdaHandler {
  constructor(
    private readonly detectionEngine: Pick<PiiDetectionEngine, 'detect'> = new PiiDetectionEngine(),
    private readonly logger: DiagnosticLogger = console,
    private readonly now: () => number = Date.now,
  ) {}

  handle(event: unknown): DetectPiiResponse {
    const startedAt = this.now();
    validateDetectPiiRequest(event);

    const response = this.detectionEngine.detect(event);
    this.logger.info('PII detection completed', {
      inputCount: event.items.length,
      detectedCount: response.results.filter((result) => result.status === 'DETECTED').length,
      unsupportedCount: response.results.filter((result) => result.status === 'UNSUPPORTED_PATH').length,
      durationMs: this.now() - startedAt,
    });

    return response;
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
