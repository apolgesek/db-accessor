import Joi from 'joi';

const pkPattern = Joi.string().pattern(/^USER#[a-zA-Z0-9-]+$/, 'PK format');
const skPattern = Joi.string().pattern(/^REQUEST#\d+#[-a-f0-9]{36}$/, 'SK format');

export const requestSchema = Joi.object({
  PK: pkPattern.required(),
  SK: skPattern.required(),
});
