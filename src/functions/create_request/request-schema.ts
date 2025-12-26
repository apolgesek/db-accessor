import Joi from 'joi';

export const requestSchema = Joi.object({
  duration: Joi.number().integer().min(1).max(24).required(),
  table: Joi.string().required(),
  targetPK: Joi.string().required(),
  targetSK: Joi.string(),
  reason: Joi.string().max(1024).required(),
  accountId: Joi.string()
    .regex(/^\d{12}$/, { name: '12 digit account ID' })
    .required(),
  region: Joi.string().required(),
});
