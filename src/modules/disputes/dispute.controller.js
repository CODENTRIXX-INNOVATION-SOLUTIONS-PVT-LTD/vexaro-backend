const { success, created, paginated } = require('../../utils');
const { wrapController } = require('../../utils/errors');
const { paginate } = require('../../utils/pagination');
const {
  listDisputesService, createDisputeService, getDisputeService, updateDisputeService,
  raiseWeightDisputeService, listWeightDisputesService, resolveWeightDisputeService, submitDisputeProofService
} = require('./dispute.service');

const wrap = wrapController;

exports.listDisputes  = wrap(async (req, res) => {
  const query = req.validated.query;
  const { page, limit } = paginate(query);
  const { items, total } = await listDisputesService(query, req.user);
  return res.status(200).json({
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

exports.createDispute = wrap(async (req, res) => created(res, 'Dispute raised', await createDisputeService(req.validated.body, req.user)));
exports.getDispute    = wrap(async (req, res) => success(res, 'Dispute retrieved', await getDisputeService(req.params.id, req.user)));
exports.updateDispute = wrap(async (req, res) => success(res, 'Dispute updated', await updateDisputeService(req.params.id, req.validated.body, req.user)));

// Weight Disputes
exports.raiseWeightDispute = wrap(async (req, res) => created(res, 'Weight dispute raised successfully', await raiseWeightDisputeService(req.validated.body, req.user)));

exports.listWeightDisputes   = wrap(async (req, res) => {
  const query = req.validated.query;
  const { page, limit } = paginate(query);
  const { items, total } = await listWeightDisputesService(query, req.user);
  return res.status(200).json({
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

exports.resolveWeightDispute = wrap(async (req, res) => success(res, 'Weight dispute resolved', await resolveWeightDisputeService(req.params.id, req.validated.body, req.user)));
exports.submitDisputeProof = wrap(async (req, res) => success(res, 'Dispute proof submitted', await submitDisputeProofService(req.params.id, req.validated.body, req.user)));
