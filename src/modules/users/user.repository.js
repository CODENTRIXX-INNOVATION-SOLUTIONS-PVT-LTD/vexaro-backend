'use strict';

const { User } = require('./user.model');

/**
 * User Repository
 * Pure data-access layer — no business logic, no try/catch.
 */

/** Find an active (non-deleted) user by MongoDB _id, optionally populating invitedBy. */
const findById = (id, populate = false) => {
  const q = User.findById(id);
  return populate ? q.populate('invitedBy', 'firstName lastName email role') : q;
};

/** Find one user matching a filter. */
const findOne = (filter) => User.findOne(filter);

/** Find one user by email (case-insensitive, trimmed). */
const findByEmail = (email) =>
  User.findOne({ email: email.toLowerCase().trim() });

/**
 * Paginated list of users matching a filter.
 * Returns [users[], total].
 */
const findPaginated = async (filter, { skip, limit, sort = { createdAt: -1 } } = {}) => {
  return Promise.all([
    User.find(filter)
      .select('firstName lastName email phone companyName isActive role createdAt')
      .populate('invitedBy', 'firstName lastName email role')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
};

/** Create a new user inside a Mongoose session (for transactions). */
const createInSession = (data, session) =>
  User.create([data], { session });

/** Update a user by _id and return the updated document. */
const findByIdAndUpdate = (id, update, options = {}) =>
  User.findByIdAndUpdate(id, update, { new: true, ...options });

/** Save a user document (triggers pre-save hooks). */
const save = (user, options = {}) => user.save(options);

/** Count users matching a filter. */
const count = (filter) => User.countDocuments(filter);

/** Find all users matching a filter, selecting only specified fields. */
const findAll = (filter, projection) =>
  User.find(filter, projection);

module.exports = {
  findById,
  findOne,
  findByEmail,
  findPaginated,
  createInSession,
  findByIdAndUpdate,
  save,
  count,
  findAll,
};
