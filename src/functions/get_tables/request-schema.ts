import Joi from 'joi';

export const requestSchema = Joi.object({
  account: Joi.string()
    .regex(/^\d{12}$/)
    .required(),
  region: Joi.string().required(),
});
