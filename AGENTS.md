# Repository Guide

## Scope and navigation

Work from the repository root unless noted. Backend services and application CDK belong here. Siblings `db-accessor-ui` and `db-accessor-infra` own the UI and shared edge/DNS/certificates/frontend hosting.

- `src/functions/<snake_case>/main.ts`: Lambda entrypoints; colocated schemas and tests.
- `src/shared/`: contracts, key helpers, authentication, path grammar, and AWS utilities.
- `infra/lib/`: `stack.ts` assembles resources; `lambda-functions.ts` wires Lambdas/env/IAM; `rest-api.ts` defines routes; `dynamodb-tables.ts` and `messaging.ts` define storage/queues.
- `infra/lib/lambda-factory.ts`: maps kebab-case function names to snake_case folders and bundles `lambdaHandler` exports.

## Verification

Root and `infra/` have separate npm packages/lockfiles. Install dependencies with `npm ci` where needed; Lambda bundling also needs root dependencies.

| Check | Repository root | From `infra/` |
| --- | --- | --- |
| Type-check | `npm run compile` | `npm run build` |
| Unit tests | `npm run unit` | `npm test` |
| Focused tests | `npx jest src/functions/<folder> --runInBand` | `npx jest test/<file>.test.ts --runInBand` |
| Lint | `npm run lint` (includes infra TypeScript) | — |
| Synthesize | — | `npm run synth` |

- Root `npm test` combines compile and unit tests, excluding infra. Both TypeScript builds use `noEmit`; CDK bundles Lambdas.
- Synth requires `STAGE=dev|prod` and `infra/config/<stage>/idp/saml-metadata.xml`. PowerShell, from `infra/`: `$env:STAGE='dev'; npm run synth`.
- Start with affected tests; shared behavior changes need root test/lint, CDK changes also need infra build/test/synth. Documentation-only edits need diff/content checks.

## Code conventions

- Use `LambdaHandler`, constructor injection, and `export const lambdaHandler = handlerInstance.handle.bind(handlerInstance)`.
- HTTP handlers use colocated Joi `request-schema.ts` and shared `APIResponse.success/error`; validation failures return `400, 'Invalid request'`. Internal Lambda/SQS handlers follow their event contracts.
- Admin handlers enforce shared `isAdmin` even with API authorization. Use shared `toAppUsername`; `USERNAME_PREFIX` must be defined (empty is valid).
- Use `interface` for implemented behavior contracts and `type` for DTOs/value objects. Keep LF line endings and existing formatting.

## Data and access boundaries

- Reuse `src/shared/ruleset.ts`, `configured-table.ts`, and `pii-scan.ts` key helpers/contracts. Grant attributes are lowercase (`pk`, `sk`, `gsiPendingPk`, `gsiAllPk`); key formats live in `create_request/main.ts`.
- `get_record` resolves active ruleset scopes and unredact paths before redaction. Detector/redactor share `src/shared/path-pattern.ts` (`*`, `[]`, `[i]`, no `$` prefix); preserve compatibility.
- Shared `getStsSession` caches cross-account `DbAccessorAppRole` credentials. Scanning requires target-role `dynamodb:Scan` permission.

## PII detection and suggestions

- Private synchronous `pii_detector`: pure `PiiDetectionEngine` coordinates `detectors/` classes owning aliases/validators. Keep AWS/scanning/persistence outside the engine. Contracts: `src/shared/pii-detection.ts`; envelope limits: `pii_detector/request-validator.ts`.
- Flow: enable API or daily dispatcher → FIFO SQS → `pii_scan_worker` → synchronous detector → latest suggestion snapshot. Configured tables opt in through the sparse `gsiPiiDetection` index; suggestions require manual ruleset creation and key-scope selection.
- Admin routes: `PUT /admin/configured-tables/pii-detection` and `GET /admin/configured-tables/pii-suggestions`. Scan/task/state contracts are in `src/shared/pii-scan.ts`; queue publication is in `pii-scan-task-publisher.ts`.
- Worker modules: `dynamodb-sampler.ts`, `observation-flattener.ts`, `pii-detector-client.ts`, `suggestion-aggregator.ts`; read their constants for budgets/batching. Sampling is bounded/approximate; injected randomness defaults to `Math.random`. Retries are not reproducible.
- Flatten low-level DynamoDB values; numeric sentinels preserve path-only classification without precision loss. Normalize arrays/sets to `[]`; skip unrepresentable keys/oversized observations. Suggestion paths obey the shorter ruleset path limit.
- Sample values are permitted only in memory and synchronous detector payloads. Do not put them or target record key values in SQS tasks, logs, persisted suggestions, or admin responses. Persist paths, entity types, evidence, counts, and scan metadata; count support once per sampled record.

## Workflow

- Keep changes focused and preserve unrelated work. Add focused regression coverage for shared path/key logic and request or scan state transitions.
- Do not commit, tag, deploy, or open PRs unless explicitly requested. Use conventional commit types `feat`, `fix`, `refactor`, or `chore`; CI infers semver labels from them.
- Use the PR description format below.
- Maintain this guide for durable command/convention changes. Prefer source pointers; omit task logs, test counts, and temporary workarounds. Mention updates in the final summary.

## Pull request descriptions

Use these three sections, in this order, for every PR. Keep descriptions concise and describe the final change for a reviewer who has not seen the conversation. Include a relevant architecture diagram in Summary when expanding the architecture. Report only checks actually performed; use "None" in Deployment notes when no additional steps are needed.

```markdown
## Summary

- Describe the change and its purpose, including user-visible behavior where applicable.
- Include relevant behavior or implementation decisions.

## Verification

- List checks performed and their results.
- State any relevant behavior that wasn't verified.

## Deployment notes

- List prerequisites, migrations, or configuration changes.
- Write "None" when no additional steps are needed.
```
