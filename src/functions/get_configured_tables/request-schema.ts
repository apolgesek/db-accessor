import Joi from 'joi';

export const requestSchema = Joi.object({
  accountId: Joi.string().regex(/^\d{12}$/),
  region: Joi.string().when('accountId', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
});
