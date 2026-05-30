import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DynamoDbTables {
  auditTable: dynamodb.Table;
  grantTable: dynamodb.Table;
  rulesetTable: dynamodb.Table;
  notificationTable: dynamodb.Table;
  websocketConnectionTable: dynamodb.Table;
}

export interface CreateDynamoDbTablesOptions {
  projectName: string;
  removalPolicy: cdk.RemovalPolicy;
}

export function createDynamoDbTables(scope: Construct, options: CreateDynamoDbTablesOptions): DynamoDbTables {
  const { projectName, removalPolicy } = options;

  const auditTable = new dynamodb.Table(scope, `${projectName}-audit-logs`, {
    tableName: `${projectName}-audit-logs`,
    partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy,
  });

  const grantTable = new dynamodb.Table(scope, `${projectName}-grants`, {
    tableName: `${projectName}-grants`,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy,
  });
  grantTable.addGlobalSecondaryIndex({
    indexName: 'gsiAll',
    partitionKey: { name: 'gsiAllPk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'gsiAllSk', type: dynamodb.AttributeType.STRING },
  });
  grantTable.addGlobalSecondaryIndex({
    indexName: 'gsiPending',
    partitionKey: { name: 'gsiPendingPk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'gsiPendingSk', type: dynamodb.AttributeType.STRING },
  });

  const rulesetTable = new dynamodb.Table(scope, `${projectName}-rulesets`, {
    tableName: `${projectName}-rulesets`,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy,
  });
  rulesetTable.addGlobalSecondaryIndex({
    indexName: 'gsiAccountRegion',
    partitionKey: { name: 'gsiAccountRegionPk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'gsiAccountRegionSk', type: dynamodb.AttributeType.STRING },
  });
  rulesetTable.addGlobalSecondaryIndex({
    indexName: 'gsiAccountRegionTable',
    partitionKey: { name: 'gsiAccountRegionTablePk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'gsiAccountRegionTableSk', type: dynamodb.AttributeType.STRING },
  });

  const notificationTable = new dynamodb.Table(scope, `${projectName}-notifications`, {
    tableName: `${projectName}-notifications`,
    partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy,
  });
  notificationTable.addGlobalSecondaryIndex({
    indexName: 'gsiUserNotification',
    partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  });

  const websocketConnectionTable = new dynamodb.Table(scope, `${projectName}-websocket-connections`, {
    tableName: `${projectName}-websocket-connections`,
    partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'ttl',
    removalPolicy,
  });
  websocketConnectionTable.addGlobalSecondaryIndex({
    indexName: 'gsiUserId',
    partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  });

  return {
    auditTable,
    grantTable,
    rulesetTable,
    notificationTable,
    websocketConnectionTable,
  };
}
