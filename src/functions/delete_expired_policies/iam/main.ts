import {
  DeletePolicyCommand,
  DetachUserPolicyCommand,
  IAMClient,
  ListPoliciesCommand,
  ListPolicyTagsCommand,
  Policy,
} from '@aws-sdk/client-iam';

const LIST_POLICIES_MAX_ITEMS = 1_000;

class LambdaHandler {
  async handle(): Promise<void> {
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
        if (policy.PolicyName?.startsWith('IAM')) {
          matched.push(policy);
        }
      }

      marker = res.Marker;
    } while (marker);

    const listPolicyTagsPromises = matched.map((policy) =>
      iamClient.send(new ListPolicyTagsCommand({ PolicyArn: policy.Arn })),
    );
    const listPolicyTagsResults = await Promise.all(listPolicyTagsPromises);

    const policiesToDelete = matched.filter((x, i) =>
      listPolicyTagsResults?.[i].Tags?.some((tag) => tag?.Key === 'ExpiresAt' && Number(tag?.Value) < currentDate),
    );

    const detachUserPolicyPromises = policiesToDelete.map((policy, i) =>
      iamClient.send(
        new DetachUserPolicyCommand({
          UserName: listPolicyTagsResults?.[i].Tags?.find((x) => x.Key === 'UserName')?.Value,
          PolicyArn: policy.Arn,
        }),
      ),
    );
    const detachUserPolicyPromisesResult = await Promise.allSettled(detachUserPolicyPromises);
    const failedDetachUserPolicyOps = detachUserPolicyPromisesResult.filter((x) => x.status === 'rejected');

    if (failedDetachUserPolicyOps.length > 0) {
      console.log(
        'Detach user policy failed:',
        failedDetachUserPolicyOps.map((x) => (x as PromiseRejectedResult).reason),
      );
    }

    const deletePolicyPromises = policiesToDelete.map((policy) =>
      iamClient.send(new DeletePolicyCommand({ PolicyArn: policy.Arn })),
    );
    const deletePolicyPromisesResult = await Promise.allSettled(deletePolicyPromises);
    const failedDeletePolicyOps = deletePolicyPromisesResult.filter((x) => x.status === 'rejected');
    const successfulDeletePolicyOps = deletePolicyPromisesResult.filter((x) => x.status === 'fulfilled');

    if (failedDeletePolicyOps.length > 0) {
      console.log(
        'Delete policy failed:',
        failedDeletePolicyOps.map((x) => (x as PromiseRejectedResult).reason),
      );
    }

    console.log('Deleted policies:', successfulDeletePolicyOps.length);
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);
