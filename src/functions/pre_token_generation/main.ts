/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Context, PreTokenGenerationV2TriggerEvent } from 'aws-lambda';

const GROUP_ID_TO_ROLE: Record<string, string> = {
  '236478d2-5091-7039-872f-9f513edbb58c': 'ADMIN',
  'c3f428d2-10a1-7048-f3ee-f98bc27d9f72': 'USER',
};

function parseFlattenedIdpAttribute(value: string): string[] {
  if (!value || typeof value !== 'string') {
    return [];
  }

  let trimmed = value.trim();

  // Strip leading/trailing [ ]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    trimmed = trimmed.slice(1, -1);
  }

  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(',')
    .map((v) => decodeURIComponent(v.trim()))
    .filter((v) => v.length > 0);
}

class LambdaHandler {
  async handle(event: PreTokenGenerationV2TriggerEvent, context: Context): Promise<PreTokenGenerationV2TriggerEvent> {
    console.log('Incoming event:', JSON.stringify(event, null, 2));

    const userAttributes = event.request?.userAttributes || {};
    const groupConfig = event.request?.groupConfiguration || {};

    const rawIdcGroups = userAttributes['custom:idc_groups'] || '';
    const idcGroupIds = parseFlattenedIdpAttribute(rawIdcGroups);

    console.log('Raw IDC groups:', rawIdcGroups);
    console.log('Parsed IDC group IDs:', idcGroupIds);

    const roleSet = new Set();

    for (const groupId of idcGroupIds) {
      const role = GROUP_ID_TO_ROLE[groupId];
      if (role) {
        roleSet.add(role);
      }
    }

    const effectiveGroups = roleSet.size > 0 ? Array.from(roleSet) : groupConfig.groupsToOverride || [];

    console.log('Effective groups (to become cognito:groups):', effectiveGroups);

    const groupOverrideDetails: Record<string, any> = {
      groupsToOverride: effectiveGroups,
      iamRolesToOverride: groupConfig.iamRolesToOverride || [],
      preferredRole: groupConfig.preferredRole || null,
    };

    const claimsToAddOrOverride: Record<string, any> = {};

    if (userAttributes['preferred_username']) {
      claimsToAddOrOverride['preferred_username'] = userAttributes['preferred_username'];
    }

    claimsToAddOrOverride['app_roles'] = effectiveGroups;

    event.response = {
      claimsAndScopeOverrideDetails: {
        idTokenGeneration: {
          claimsToAddOrOverride,
        },
        accessTokenGeneration: {
          claimsToAddOrOverride,
        },
        groupOverrideDetails,
      },
    };

    console.log('Outgoing event:', JSON.stringify(event, null, 2));

    return event;
  }
}

const handlerInstance = new LambdaHandler();
export const lambdaHandler = handlerInstance.handle.bind(handlerInstance);

// refresh
