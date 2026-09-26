import Joi from 'joi';

export const requestSchema = Joi.object({
  accountId: Joi.string()
    .regex(/^\d{12}$/)
    .required(),
  region: Joi.string().required(),
  table: Joi.string().required(),
});
