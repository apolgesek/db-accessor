import Joi from 'joi';

export const requestSchema = Joi.object({
  accountId: Joi.string()
    .regex(/^\d{12}$/, { name: '12 digit account ID' })
    .required(),
  region: Joi.string().required(),
  table: Joi.string().required(),
});
