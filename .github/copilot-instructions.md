# Copilot Instructions for `db-accessor`

## Build, test, and lint

Run commands from repository root unless noted.

```bash
# App (root package)
npm ci
npm run compile
npm run lint
npm run test

# Run all tests only
npm run unit

# Run a single test file
npx jest src/shared/ruleset.test.ts
# or
npm run unit -- src/shared/ruleset.test.ts
```

```bash
# Infra (CDK package)
cd infra
npm ci
npm run build
npm run test
npm run synth
```

## High-level architecture

- This repository has two TypeScript packages:
  - **App code (root `src/`)**: Lambda handlers implementing request/grant workflows and data access.
  - **Infrastructure (`infra/`)**: CDK stack provisioning API Gateway, Cognito authorizer integration, Lambda functions, DynamoDB tables/GSIs, and GitHub OIDC deploy role.
- `infra/lib/stack.ts` wires API routes to Lambda functions, configures Cognito auth (`openid` scope), and creates three DynamoDB tables:
  - `*-grants` for request lifecycle (pending/approved/rejected and admin actions)
  - `*-rulesets` for masking rules + active snapshot lookups
  - `*-audit-logs` for record access auditing
- Cross-account record/table access is done via STS assume-role (`DbAccessorAppRole`) using helpers in `src/shared/get-sts-session.ts`, with in-memory credential caching and in-flight deduplication.
- Data redaction is applied in `get_record` using active ruleset snapshots from the ruleset table plus optional unredact paths; path-pattern redaction supports object wildcard (`*`) and array selectors (`[]`, `[i]`).
- Cognito pre-token generation (`pre_token_generation`) maps Identity Center group IDs to app roles (`ADMIN`/`USER`) and overrides token group claims; admin handlers additionally enforce `ADMIN` group checks.

## Key conventions in this codebase

- **Lambda handler shape**: each function uses a `LambdaHandler` class with a constructor-injected AWS client, then exports a singleton binding:
  - `const handlerInstance = new LambdaHandler(...)`
  - `export const lambdaHandler = handlerInstance.handle.bind(handlerInstance)`
- **Function naming contract between infra and app**:
  - Infra uses kebab-case names (for Lambda resource names).
  - Source folders in `src/functions` are snake_case.
  - `infra/lib/lambda-factory.ts` maps kebab-case to snake_case with `fnName.replaceAll('-', '_')`.
- **Request validation pattern**: handlers with input payloads use colocated Joi schemas in `request-schema.ts` and return `APIResponse.error(400, 'Invalid request')` on validation failure.
- **HTTP response standardization**: handlers use `APIResponse.success/error` (`src/shared/response.ts`) to return API Gateway responses with CORS headers.
- **Grants/ruleset key patterns are semantic and reused**:
  - Grants: `PK=USER#<id>`, `SK=REQUEST#...`, `GSI_PENDING_PK='PENDING'`, `GSI_ALL_PK='REQBUCKET#YYYY-MM'`
  - Rulesets: key builders in `src/shared/ruleset.ts` should be reused instead of ad-hoc string assembly.
- **Auth claim usage convention**:
  - Username is derived from Cognito `claims.username` by stripping `db-accessor_`.
  - Admin authorization checks `claims['cognito:groups']` for `ADMIN`.
- **CI/CD coupling to commit style**:
  - PRs enforce conventional commit types: `feat`, `fix`, `refactor`, `chore`.
  - Semver labels (`semver:major|minor|patch`) are inferred from commit messages and used by CD tagging on merge to `main`.
