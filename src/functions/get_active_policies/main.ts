import { IAMClient, ListPoliciesCommand, ListPolicyTagsCommand, Policy } from '@aws-sdk/client-iam';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Response } from '../../shared/response';

const LIST_POLICIES_MAX_ITEMS = 1_000;

class LambdaHandler {
  async handle(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    const currentDate = Date.now();
    const iamClient = new IAMClient({ region: process.env.AWS_REGION });

    let marker: string | undefined;
    const matched: Policy[] = [];

    do {
      const res = await iamClient.send(
        new ListPoliciesCommand({
          Scope: 'Local',
          Marker: marker,
          MaxItems: LIST_POLICIES_MAX_ITEMS,
        }),
      );

      for (const policy of res.Policies || []) {
        if (policy.PolicyName?.startsWith('dynamodb_GetItemPolicy')) {
          matched.push(policy);
        }
      }

      marker = res.Marker;
    } while (marker);

    const listPolicyTagsPromises = matched.map((policy) =>
      iamClient.send(new ListPolicyTagsCommand({ PolicyArn: policy.Arn })),
    );
    const listPolicyTagsResults = await Promise.all(listPolicyTagsPromises);

    const activePolicies = matched.filter((x, i) =>
      listPolicyTagsResults?.[i].Tags?.some((tag) => tag?.Key === 'ExpiresAt' && Number(tag?.Value) > currentDate),
    );

    const response = activePolicies.map((policy) => {
      const expiresAt = listPolicyTagsResults
        ?.find((_, i) => matched[i].PolicyId === policy.PolicyId)
        ?.Tags?.find((tag) => tag?.Key === 'ExpiresAt')?.Value;

      return {
        policyName: policy.PolicyName,
        policyId: policy.PolicyId,
        arn: policy.Arn,
        creationDate: policy.CreateDate,
        expiresAt: expiresAt ? Number(expiresAt) : null,
      };
    });

    return Response.success(response);
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);

// refresh 1
