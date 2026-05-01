/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  AttributeValue,
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EntityRequest } from '../../shared/entity-request';
import { getStsSession } from '../../shared/get-sts-session';
import { IssueTrackingAuditEvent } from '../../shared/issue-tracking-audit-event';
import { APIResponse } from '../../shared/response';
import {
  ACTIVE_RULESET_SK,
  ActiveRulesetSnapshot,
  getRulesetSnapshotPk,
  resolveActiveMaskRuleset,
} from '../../shared/ruleset';
import { DEFAULT_REDACTION, PathPatternRedactor } from './redactor';
import { base64urlDecode, toJsonSafe } from './utils';

const MS_IN_HOUR = 3_600_000;

interface IIssueTrackingAuditPublisher {
  publish(event: IssueTrackingAuditEvent): Promise<void>;
}

export class SqsIssueTrackingAuditPublisher implements IIssueTrackingAuditPublisher {
  constructor(private readonly sqsClient: SQSClient, private readonly queueUrl?: string) {}

  async publish(event: IssueTrackingAuditEvent): Promise<void> {
    if (!this.queueUrl) {
      console.warn('Issue tracking audit queue URL is not configured');
      return;
    }

    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(event),
      }),
    );
  }
}

class LambdaHandler {
  constructor(
    private readonly ddbClient: DynamoDBClient,
    private readonly issueTrackingAuditPublisher: IIssueTrackingAuditPublisher,
  ) {}

  async handle(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const claims = event.requestContext?.authorizer?.claims ?? {};
    const username = claims.username.split('db-accessor_')[1];
    const pathParams = event.pathParameters || {};
    const getItemResponse = await this.ddbClient.send(
      new GetItemCommand({
        TableName: process.env.GRANTS_TABLE_NAME,
        Key: {
          PK: { S: `USER#${username}` },
          SK: { S: base64urlDecode(pathParams.id as string) },
        },
      }),
    );

    if (!getItemResponse.Item) {
      return APIResponse.error(404);
    }

    const item = unmarshall(getItemResponse.Item) as EntityRequest;
    const adminApproval = item.approvedBy?.find((x) => x.role === 'ADMIN');

    if (!adminApproval || Date.now() > new Date(adminApproval.approvedAt).getTime() + item.duration * MS_IN_HOUR) {
      return APIResponse.error(404);
    }

    const creds = await getStsSession(item.accountId, item.region);
    const targetDbClient = new DynamoDBClient({
      region: item.region,
      credentials: creds,
    });

    const describeTableResponse = await targetDbClient.send(new DescribeTableCommand({ TableName: item.table }));

    if (!describeTableResponse.Table) {
      return APIResponse.error(400, 'Invalid table');
    }

    const pkName = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName ?? '';
    const skName = describeTableResponse.Table.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName;

    const accessor = new RecordAccessor(targetDbClient, this.ddbClient);
    const result = await accessor.getRecord({ ...item, pkName, skName });
    const createdAt = new Date().getTime().toString();

    await this.ddbClient.send(
      new PutItemCommand({
        TableName: process.env.AUDIT_LOGS_TABLE_NAME,
        Item: {
          UserId: { S: item.userId },
          CreatedAt: { N: createdAt },
          TableName: { S: item.table },
          TargetPK: { S: item.targetPK },
          TargetSK: { S: item.targetSK || 'N/A' },
        },
      }),
    );
    await this.publishIssueTrackingAuditEvent(item, createdAt);

    return APIResponse.success(200, { ...result, request: item });
  }

  private async publishIssueTrackingAuditEvent(item: EntityRequest, createdAt: string): Promise<void> {
    const issueKey = 'FEYES-5';
    const requestId = item.SK.split('#').at(-1) ?? '';
    try {
      await this.issueTrackingAuditPublisher.publish({
        version: 1,
        eventType: 'RECORD_ACCESSED',
        issueKey,
        userId: item.userId,
        requestId,
        tableName: item.table,
        targetPK: item.targetPK,
        targetSK: item.targetSK || 'N/A',
        accountId: item.accountId,
        region: item.region,
        stage: process.env.STAGE,
        dateTime: createdAt,
      });
    } catch (err) {
      console.warn('Failed to enqueue issue tracking audit event', {
        issueKey,
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

class RecordAccessor {
  constructor(private readonly targetDbClient: DynamoDBClient, private readonly metadataDbClient: DynamoDBClient) {}

  async getRecord(
    request: EntityRequest & { pkName: string; skName?: string },
  ): Promise<{ item: Record<string, unknown>; maskRuleset: string[] | null } | null> {
    const pk = request.targetPK;
    const sk = request.targetSK;
    const PK_NAME = request.pkName;
    const SK_NAME = request.skName;
    const TABLE_NAME = request.table;

    const key: Record<string, AttributeValue> = {
      [PK_NAME]: { S: pk },
    };

    if (sk) {
      key[SK_NAME!] = { S: sk };
    }

    const resp = await this.targetDbClient.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: key,
        ConsistentRead: false,
      }),
    );

    if (!resp.Item) return null;

    let item = toJsonSafe(unmarshall(resp.Item)) as Record<string, unknown>;
    let maskRuleset = await this.findMaskRuleset(request);
    const unredactPaths = request.unredactRequests?.flatMap((r) => r.paths) || [];

    if (maskRuleset) {
      maskRuleset = maskRuleset.filter((r) => !unredactPaths.includes(r));
    }

    if (maskRuleset) {
      const redactor = new PathPatternRedactor(maskRuleset, DEFAULT_REDACTION);
      item = redactor.redact(item);
    }

    return { item, maskRuleset };
  }

  async findMaskRuleset(request: EntityRequest): Promise<null | string[]> {
    const res = await DynamoDBDocumentClient.from(this.metadataDbClient).send(
      new GetCommand({
        TableName: process.env.RULESET_TABLE_NAME,
        Key: {
          PK: getRulesetSnapshotPk(request.accountId, request.region, request.table),
          SK: ACTIVE_RULESET_SK,
        },
        ConsistentRead: false,
      }),
    );

    return resolveActiveMaskRuleset((res.Item as ActiveRulesetSnapshot | undefined)?.activeRulesets, request);
  }
}

const handlerInstance = new LambdaHandler(
  new DynamoDBClient({ region: process.env.AWS_REGION }),
  new SqsIssueTrackingAuditPublisher(
    new SQSClient({ region: process.env.AWS_REGION }),
    process.env.ISSUE_TRACKING_AUDIT_QUEUE_URL,
  ),
);
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
