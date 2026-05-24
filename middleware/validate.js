const Joi = require('joi');

/**
 * Validation middleware factory
 * Creates middleware that validates request body against a Joi schema
 * @param {Object} schema - Joi validation schema
 * @param {String} property - Request property to validate ('body', 'query', 'params')
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors,
        requestId: req.id
      });
    }

    req[property] = value;
    next();
  };
};

module.exports = validate;
