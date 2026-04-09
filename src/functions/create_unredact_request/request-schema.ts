import Joi from 'joi';

export const requestSchema = Joi.object({
  reason: Joi.string().max(1024).required(),
  paths: Joi.array().items(Joi.string()).min(1).required(),
});
