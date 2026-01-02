import Joi from 'joi';

const ym = Joi.string().pattern(/^\d{4}-\d{2}$/, 'YYYY-MM');

export const requestSchema = Joi.object({
  startDate: ym.allow(null).optional(),
  endDate: ym.allow(null).optional(),
  status: Joi.string().valid('PENDING').optional(),
}).and('startDate', 'endDate');
