/**
 * Parses page and limit parameters from request query, and calculates skip.
 * Enforces a hard maximum of 100 per page to prevent accidental full-collection dumps.
 */
const MAX_PAGE_LIMIT = 100;

const getPaginationParams = (query, defaultLimit = 20) => {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const requestedLimit = query.limit || query.pageSize;
  const limit = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, parseInt(requestedLimit, 10) || defaultLimit),
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Generates pagination metadata for API responses.
 * Includes limit and navigation flags so the frontend never needs to guess.
 */
const buildPaginationMeta = (total, page, limit) => {
  const pages = Math.ceil(total / limit) || 1;
  return {
    total,
    page,
    limit,
    pages,
    hasNextPage: page < pages,
    hasPrevPage: page > 1,
  };
};

module.exports = {
  getPaginationParams,
  buildPaginationMeta,
};
