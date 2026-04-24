import Joi from 'joi';

export const requestSchema = Joi.object({
  accountId: Joi.string()
    .regex(/^\d{12}$/, { name: '12 digit account ID' })
    .required(),
  region: Joi.string().required(),
  table: Joi.string().required(),
  ruleset: Joi.array()
    .items(
      Joi.object({
        path: Joi.string().max(255).required(),
        ruleDescription: Joi.string().max(255).optional(),
      }),
    )
    .required(),
  targetPK: Joi.string().required(),
  targetSK: Joi.string().optional(),
  pkOperator: Joi.string().valid('BEGINS_WITH', 'EQUALS').optional(),
  skOperator: Joi.string().valid('BEGINS_WITH', 'EQUALS').when('targetSK', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});
