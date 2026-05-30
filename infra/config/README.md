Place SAML metadata XML files under the environment-specific config directory when an environment should use a file-backed external IdP.

Lookup paths:

- `infra/config/dev/idp/saml-metadata.xml`
- `infra/config/prod/idp/saml-metadata.xml`

SAML assertion attributes are hardcoded as:

- `Email`, mapped into Cognito `email`
- `Subject`, mapped into Cognito `preferred_username`
- `Groups`, mapped into Cognito `custom:idc_groups`

If the IdP emits different attribute names, update the hardcoded attribute mapping in `infra/lib/cognito.ts`.
