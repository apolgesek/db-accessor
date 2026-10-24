// Cognito web-client token lifetimes. The CDK app client declares them, and session Lambdas size row
// retention from them, so both read these constants. CDK-free.
export const ACCESS_TOKEN_VALIDITY_MINUTES = 15;
export const ID_TOKEN_VALIDITY_MINUTES = 15;
export const REFRESH_TOKEN_VALIDITY_HOURS = 12;
