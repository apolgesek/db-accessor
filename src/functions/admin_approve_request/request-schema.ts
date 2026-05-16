import Joi from 'joi';

const pkPattern = Joi.string().pattern(/^USER#[a-zA-Z0-9-]+$/, 'pk format');
const skPattern = Joi.string().pattern(/^REQUEST#\d+#[-a-f0-9]{36}$/, 'sk format');

export const requestSchema = Joi.object({
  pk: pkPattern.required(),
  sk: skPattern.required(),
  comment: Joi.string().max(500).allow(null),
});
