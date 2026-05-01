# Agent Notes

Work from the repo root unless a command says otherwise.

## Commands

App package:

```bash
npm ci
npm run compile
npm run lint
npm run test
npm run unit
npx jest src/shared/ruleset.test.ts
```

Infra package:

```bash
cd infra
npm ci
npm run build
npm run test
npm run synth
```

## Architecture

- Root `src/`: TypeScript Lambda handlers for request/grant, record access, rulesets, and Cognito token customization.
- `infra/`: CDK stack for API Gateway, Cognito authorizer, Lambdas, DynamoDB tables/GSIs, and GitHub OIDC deploy role.
- Main tables from `infra/lib/stack.ts`:
  - `*-grants`: request lifecycle and admin approvals/rejections.
  - `*-rulesets`: ruleset history plus active masking snapshots.
  - `*-audit-logs`: record access audit entries.
- Cross-account access uses STS assume-role `DbAccessorAppRole` via `src/shared/get-sts-session.ts` with credential caching and in-flight dedupe.
- Redaction is resolved in `get_record` from active rulesets plus unredact paths. Path patterns support object wildcard `*` and array selectors `[]` / `[i]`.
- `pre_token_generation` maps Identity Center group IDs to app roles (`ADMIN`, `USER`). Admin handlers must still enforce `ADMIN`.

## Code Contracts

- Lambda handlers use:
  - `class LambdaHandler`
  - constructor-injected AWS clients where useful
  - singleton export: `export const lambdaHandler = handlerInstance.handle.bind(handlerInstance)`
- Infra Lambda names are kebab-case; source folders under `src/functions` are snake_case. `infra/lib/lambda-factory.ts` maps with `fnName.replaceAll('-', '_')`.
- Validate inputs with colocated `request-schema.ts` Joi schemas. On validation failure return `APIResponse.error(400, 'Invalid request')`.
- Return API Gateway responses through `src/shared/response.ts` (`APIResponse.success/error`) to keep CORS consistent.
- Reuse key helpers in `src/shared/ruleset.ts`; do not manually rebuild ruleset keys.
- Grants key conventions:
  - `PK=USER#<id>`
  - `SK=REQUEST#...`
  - `GSI_PENDING_PK=PENDING`
  - `GSI_ALL_PK=REQBUCKET#YYYY-MM`
- Auth conventions:
  - Username comes from `claims.username` after removing `db-accessor_`.
  - Admin check reads `claims['cognito:groups']` and requires `ADMIN`.
- TypeScript convention:
  - `interface` for behavior/contracts implemented by classes.
  - `type` for DTOs, data models, and value objects.
- Keep line endings LF.

## Workflow

- Prefer focused changes. Do not refactor unrelated handlers or infra while fixing one path.
- Add or update focused tests when touching shared ruleset/redaction/key logic or request state transitions.
- Run the narrowest useful verification first; run broader commands when touching shared code.
- Never commit, tag, deploy, or open PRs unless explicitly asked.
- PR commit style is conventional commit compatible: `feat`, `fix`, `refactor`, `chore`; semver labels are inferred downstream.
