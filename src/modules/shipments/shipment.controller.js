const crypto        = require('crypto');
const {
  listShipmentsService,
  createShipmentService,
  getShipmentByIdService,
  updateShipmentService,
  deleteShipmentService,
  updateStatusService,
  processBulkUploadAsync,
  awbSearchService,
  shipmentStatsService,
  checkServiceabilityService,
  getVelocityRatesService,
  createReverseShipmentService,
} = require('./shipment.service');
const { BulkJob } = require('./bulk-job.model');
const { success, created, paginated } = require('../../utils');
const { wrapController } = require('../../utils/errors');
const { paginate } = require('../../utils/pagination');
const { parse } = require('csv-parse/sync');

// ─── Multer: memory storage for CSV upload ────────────────────────────────────
// Store file in memory (buffer) — no disk writes needed for CSV parsing.
const withErrorHandling = wrapController;

// ─── GET /api/shipments ────────────────────────────────────────────────────────
const listShipments = withErrorHandling(async (req, res) => {
  const query = req.validated.query;
  const { page, limit } = paginate(query);
  const { items, total } = await listShipmentsService(query, req.user);
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

// ─── POST /api/shipments ───────────────────────────────────────────────────────
const createShipment = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const shipment = await createShipmentService(dto, req.user);
  created(res, 'Shipment created successfully', shipment);
});

// ─── GET /api/shipments/stats ─────────────────────────────────────────────────
const getShipmentStats = withErrorHandling(async (req, res) => {
  const stats = await shipmentStatsService(req.user);
  success(res, 'Shipment stats retrieved', stats);
});

// ─── GET /api/shipments/track/:awb ────────────────────────────────────────────
const trackByAWB = withErrorHandling(async (req, res) => {
  const { awb } = req.validated.params;
  const shipment = await awbSearchService(awb, req.user);
  
  const safeData = {
    awb: shipment.awb,
    carrier: shipment.carrier,
    carrierAWB: shipment.carrierAWB,
    status: shipment.status,
    history: (shipment.history || []).map(h => ({
      status: h.status,
      timestamp: h.timestamp,
      note: h.note,
    })),
    origin: {
      city: shipment.origin?.city,
      state: shipment.origin?.state,
    },
    destination: {
      city: shipment.destination?.city,
      state: shipment.destination?.state,
    },
    weight: shipment.weight,
    serviceType: shipment.serviceType,
    createdAt: shipment.createdAt,
    velocityTracking: shipment.velocityTracking,
  };

  success(res, 'Shipment found', safeData);
});

// ─── GET /api/shipments/:id ───────────────────────────────────────────────────
const getShipmentById = withErrorHandling(async (req, res) => {
  const shipment = await getShipmentByIdService(req.params.id, req.user);
  success(res, 'Shipment retrieved successfully', shipment);
});

// ─── PATCH /api/shipments/:id ─────────────────────────────────────────────────
const updateShipment = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const shipment = await updateShipmentService(req.params.id, dto, req.user);
  success(res, 'Shipment updated successfully', shipment);
});

// ─── DELETE /api/shipments/:id ────────────────────────────────────────────────
const deleteShipment = withErrorHandling(async (req, res) => {
  const result = await deleteShipmentService(req.params.id, req.user);
  success(res, result.message);
});

// ─── PATCH /api/shipments/:id/status ─────────────────────────────────────────
const updateStatus = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const shipment = await updateStatusService(req.params.id, dto, req.user);
  success(res, `Shipment status updated to ${shipment.status}`, shipment);
});

// ─── POST /api/shipments/bulk-upload ─────────────────────────────────────────
// Returns 202 immediately with a jobId.
// Processing runs in the background via setImmediate.
// Poll GET /api/shipments/bulk-status/:jobId for progress.
const EXCEL_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const REQUIRED_BULK_COLS = [
  'origin_name', 'origin_phone', 'origin_address', 'origin_city', 'origin_state', 'origin_pincode',
  'dest_name', 'dest_phone', 'dest_address', 'dest_city', 'dest_state', 'dest_pincode', 'weight',
];

const bulkUpload = withErrorHandling(async (req, res) => {
  if (!req.file) {
    throw Object.assign(new Error('File is required. Send as multipart/form-data with field name "file".'), { statusCode: 400 });
  }

  const mimetype = req.file.mimetype;
  const isExcel  = EXCEL_MIMES.has(mimetype);
  let totalRows  = 0;

  if (isExcel) {
    // Count rows from first sheet
    try {
      const xlsx = require('xlsx');
      const wb   = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = xlsx.utils.sheet_to_json(sheet, { defval: '' });
      totalRows   = rows.length;
    } catch (xlsxErr) {
      throw Object.assign(new Error(`Excel parse error: ${xlsxErr.message}`), { statusCode: 400 });
    }
  } else {
    // CSV: validate headers using first rows only
    let rows;
    try {
      rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, to: 2 });
    } catch (parseErr) {
      throw Object.assign(new Error(`CSV parse error: ${parseErr.message}`), { statusCode: 400 });
    }

    if (!rows.length) {
      throw Object.assign(new Error('CSV file is empty.'), { statusCode: 400 });
    }

    const headers    = Object.keys(rows[0]).map(h => h.toLowerCase().trim());
    const missingCols = REQUIRED_BULK_COLS.filter(col => !headers.includes(col));
    if (missingCols.length) {
      throw Object.assign(
        new Error(`CSV missing required columns: ${missingCols.join(', ')}`),
        { statusCode: 400 },
      );
    }

    // Count all rows
    let allRows;
    try {
      allRows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch {
      allRows = rows;
    }
    totalRows = allRows.length;
  }

  // Create the job record
  const jobId = `BULK-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await BulkJob.create({
    jobId,
    userId:    req.user.userId,
    status:    'QUEUED',
    totalRows,
  });

  // Store caller context to pass into async processor
  const caller     = req.user;
  const fileBuffer = req.file.buffer;
  const fileMime   = mimetype;

  // Fire-and-forget — processing starts after response is sent
  setImmediate(() => processBulkUploadAsync(jobId, fileBuffer, caller, fileMime).catch(() => {}));

  return res.status(202).json({
    success: true,
    message: `Bulk upload queued. ${totalRows} rows will be processed in the background.`,
    data: {
      jobId,
      status: 'QUEUED',
      estimatedCompletion: new Date(Date.now() + totalRows * 200).toISOString(),
    },
    requestId: req.requestId || null,
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/shipments/bulk-status/:jobId ────────────────────────────────────
const getBulkUploadStatus = withErrorHandling(async (req, res) => {
  const job = await BulkJob.findOne({
    jobId:  req.params.jobId,
    userId: req.user.userId,
  });

  if (!job) {
    throw Object.assign(new Error('Bulk upload job not found'), { statusCode: 404 });
  }

  success(res, 'Bulk upload status retrieved', {
    jobId:       job.jobId,
    status:      job.status,
    totalRows:   job.totalRows,
    createdRows: job.createdRows,
    failedRows:  job.failedRows,
    errors:      job.rowErrors.slice(0, 50),   // cap errors shown in status response
    fatalError:  job.fatalError,
    createdAt:   job.createdAt,
  });
});

// ─── POST /api/shipments/serviceability ──────────────────────────────────────
const checkServiceability = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const result = await checkServiceabilityService(dto, req.user);
  success(res, 'Serviceability checked successfully', result);
});

// ─── POST /api/shipments/velocity-rates ───────────────────────────────────────
const getVelocityRates = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const result = await getVelocityRatesService(dto);
  success(res, 'Velocity rates retrieved successfully', result);
});

// ─── POST /api/shipments/reverse ─────────────────────────────────────────────
const createReverseShipment = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const shipment = await createReverseShipmentService(dto, req.user);
  created(res, 'Reverse shipment created successfully', shipment);
});

module.exports = {
  listShipments,
  createShipment,
  getShipmentStats,
  trackByAWB,
  getShipmentById,
  updateShipment,
  deleteShipment,
  updateStatus,
  bulkUpload,
  getBulkUploadStatus,
  checkServiceability,
  getVelocityRates,
  createReverseShipment,
};
