'use strict';

const { sanitizeObject } = require('../sanitizers/string.sanitizer');

const TARGETS = new Set(['body', 'query', 'params', 'headers', 'file', 'files']);

function createValidationError(issues, source = 'request') {
  const errors = issues.map((issue) => ({
    field: issue.path?.length ? `${source}.${issue.path.join('.')}` : source,
    code: issue.code || 'VALIDATION_FAILED',
    message: issue.message || 'Invalid value',
  }));
  return Object.assign(new Error('Validation failed'), {
    name: 'ValidationError',
    statusCode: 400,
    errors,
  });
}

function validate(schema, source = 'body', options = {}) {
  if (!schema || typeof schema.safeParseAsync !== 'function') throw new TypeError('A Zod schema is required');
  if (!TARGETS.has(source)) throw new TypeError(`Unsupported validation source: ${source}`);

  return async function validationMiddleware(req, _res, next) {
    try {
      const raw = req[source];
      const input = options.sanitize === false || source === 'file' || source === 'files'
        ? raw
        : sanitizeObject(raw, options.sanitizeOptions);
      const result = await schema.safeParseAsync(input);
      if (!result.success) return next(createValidationError(result.error.issues, source));

      req.validated = req.validated || {};
      req.validated[source] = result.data;
      if (source === 'body' || source === 'params' || source === 'query') req[source] = result.data;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function validateRequest(schemas, options = {}) {
  if (!schemas || typeof schemas !== 'object') throw new TypeError('Validation schemas are required');
  const entries = Object.entries(schemas);
  if (!entries.length) throw new TypeError('At least one validation target is required');
  entries.forEach(([source, schema]) => {
    if (!TARGETS.has(source)) throw new TypeError(`Unsupported validation source: ${source}`);
    if (!schema || typeof schema.safeParseAsync !== 'function') throw new TypeError(`Invalid schema for ${source}`);
  });

  return async function requestValidationMiddleware(req, _res, next) {
    try {
      const validated = {};
      const collectedErrors = [];
      for (const [source, schema] of entries) {
        const raw = req[source];
        const input = options.sanitize === false || source === 'file' || source === 'files'
          ? raw
          : sanitizeObject(raw, options.sanitizeOptions);
        const result = await schema.safeParseAsync(input);
        if (result.success) validated[source] = result.data;
        else collectedErrors.push(...createValidationError(result.error.issues, source).errors);
      }
      if (collectedErrors.length) {
        return next(Object.assign(new Error('Validation failed'), {
          name: 'ValidationError', statusCode: 400, errors: collectedErrors,
        }));
      }

      req.validated = { ...(req.validated || {}), ...validated };
      if (Object.prototype.hasOwnProperty.call(validated, 'body')) req.body = validated.body;
      if (Object.prototype.hasOwnProperty.call(validated, 'params')) req.params = validated.params;
      if (Object.prototype.hasOwnProperty.call(validated, 'query')) req.query = validated.query;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function createValidator(schema, source = 'body', options) { return validate(schema, source, options); }
function createMultiValidator(schemas, options) {
  return Object.entries(schemas).map(([source, schema]) => validate(schema, source, options));
}

module.exports = {
  TARGETS,
  validate,
  validateRequest,
  createValidator,
  createMultiValidator,
  createValidationError,
};
