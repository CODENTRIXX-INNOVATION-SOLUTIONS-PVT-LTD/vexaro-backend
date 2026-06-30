'use strict';

/**
 * AddressBook Controller Unit Tests
 *
 * Tests HTTP layer behaviour: correct service calls, response shape,
 * error propagation, extraction of merchantId from req.user, and
 * validated DTO access via req.validated.
 */

const {
  createAddress,
  listAddresses,
  getAddressById,
  updateAddress,
  deleteAddress,
} = require('../../../src/modules/users/address-book.controller');

// ─── Mock service layer ────────────────────────────────────────────────────────
jest.mock('../../../src/modules/users/address-book.service', () => ({
  createAddressService:    jest.fn(),
  listAddressesService:    jest.fn(),
  getAddressByIdService:   jest.fn(),
  updateAddressService:    jest.fn(),
  deleteAddressService:    jest.fn(),
  markAddressUsedService:  jest.fn(),
}));

const {
  createAddressService,
  listAddressesService,
  getAddressByIdService,
  updateAddressService,
  deleteAddressService,
} = require('../../../src/modules/users/address-book.service');

// ─── Helpers ───────────────────────────────────────────────────────────────────

const MERCHANT_ID = '507f1f77bcf86cd799439011';
const ADDRESS_ID  = '507f1f77bcf86cd799439012';

/** Build a minimal mock Express request */
const mockReq = (overrides = {}) => {
  const req = {
    user:      { userId: MERCHANT_ID, role: 'MERCHANT' },
    validated: {},
    params:    {},
    requestId: 'test-req-id',
    ...overrides,
  };
  if (overrides.validated && overrides.validated.params) {
    req.params = { ...req.params, ...overrides.validated.params };
  }
  return req;
};

/** Build a mock Express response that captures the last json() call */
const mockRes = () => {
  const res = {
    _status: 200,
    _body:   null,
    req:     { requestId: 'test-req-id' },
  };
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockImplementation((body) => { res._body = body; return res; });
  return res;
};

const mockNext = () => jest.fn();

/** Unwrap the wrapController async handler */
const callHandler = async (handler, req, res, next) => handler(req, res, next);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAddress = {
  _id:         ADDRESS_ID,
  merchantId:  MERCHANT_ID,
  name:        'John Doe',
  phone:       '9876543210',
  email:       'john@example.com',
  addressLine: '123 Main Street',
  city:        'Mumbai',
  state:       'Maharashtra',
  pincode:     '400001',
  country:     'India',
  label:       'Store',
  lastUsedAt:  null,
  deletedAt:   null,
  createdAt:   new Date('2024-01-01'),
  updatedAt:   new Date('2024-01-01'),
};

const createDto = {
  name:        'John Doe',
  phone:       '9876543210',
  addressLine: '123 Main Street',
  city:        'Mumbai',
  state:       'Maharashtra',
  pincode:     '400001',
};

// ─── createAddress ─────────────────────────────────────────────────────────────

describe('createAddress controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls createAddressService with validated body + merchantId and responds 201', async () => {
    createAddressService.mockResolvedValue(mockAddress);

    const req  = mockReq({ validated: { body: createDto } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(createAddress, req, res, next);

    expect(createAddressService).toHaveBeenCalledWith(createDto, MERCHANT_ID);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res._body.success).toBe(true);
    expect(res._body.message).toBe('Address created successfully');
    expect(res._body.data).toEqual(mockAddress);
  });

  test('calls next(error) when service throws', async () => {
    const err = Object.assign(new Error('Merchant not found'), { statusCode: 403 });
    createAddressService.mockRejectedValue(err);

    const req  = mockReq({ validated: { body: createDto } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(createAddress, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── listAddresses ─────────────────────────────────────────────────────────────

describe('listAddresses controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns paginated response with correct meta', async () => {
    listAddressesService.mockResolvedValue({
      addresses:  [mockAddress],
      pagination: { total: 25, page: 2, pageSize: 10, pages: 3 },
    });

    const req  = mockReq({ validated: { query: { page: 2, pageSize: 10 } } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(listAddresses, req, res, next);

    expect(listAddressesService).toHaveBeenCalledWith({ page: 2, pageSize: 10 }, MERCHANT_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data.addresses).toHaveLength(1);
    // Pagination meta should include hasNextPage / hasPrevPage from buildPaginationMeta
    expect(res._body.meta.total).toBe(25);
    expect(res._body.meta.hasPrevPage).toBe(true);
    expect(res._body.meta.hasNextPage).toBe(true);
  });

  test('calls next(error) when service throws', async () => {
    const err = Object.assign(new Error('Forbidden'), { statusCode: 403 });
    listAddressesService.mockRejectedValue(err);

    const req  = mockReq({ validated: { query: {} } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(listAddresses, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

// ─── getAddressById ────────────────────────────────────────────────────────────

describe('getAddressById controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns address and responds 200', async () => {
    getAddressByIdService.mockResolvedValue(mockAddress);

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID } } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(getAddressById, req, res, next);

    expect(getAddressByIdService).toHaveBeenCalledWith(ADDRESS_ID, MERCHANT_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._body.data).toEqual(mockAddress);
  });

  test('calls next(error) with 404 when address not found', async () => {
    const err = Object.assign(new Error('Address not found'), { statusCode: 404 });
    getAddressByIdService.mockRejectedValue(err);

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID } } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(getAddressById, req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

// ─── updateAddress ─────────────────────────────────────────────────────────────

describe('updateAddress controller', () => {
  beforeEach(() => jest.clearAllMocks());

  const updateDto = { name: 'Jane Doe', city: 'Pune' };

  test('calls updateAddressService with id, dto, merchantId and responds 200', async () => {
    const updated = { ...mockAddress, ...updateDto };
    updateAddressService.mockResolvedValue(updated);

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID }, body: updateDto } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(updateAddress, req, res, next);

    expect(updateAddressService).toHaveBeenCalledWith(ADDRESS_ID, updateDto, MERCHANT_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._body.message).toBe('Address updated successfully');
    expect(res._body.data.name).toBe('Jane Doe');
  });

  test('calls next(error) with 404 when address not found', async () => {
    const err = Object.assign(new Error('Address not found'), { statusCode: 404 });
    updateAddressService.mockRejectedValue(err);

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID }, body: updateDto } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(updateAddress, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  test('calls next(error) with 500 when update DB operation fails', async () => {
    const err = Object.assign(new Error('Failed to update address'), { statusCode: 500 });
    updateAddressService.mockRejectedValue(err);

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID }, body: updateDto } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(updateAddress, req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });
});

// ─── deleteAddress ─────────────────────────────────────────────────────────────

describe('deleteAddress controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls deleteAddressService and responds 200 with success message', async () => {
    deleteAddressService.mockResolvedValue({ message: 'Address deleted successfully' });

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID } } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(deleteAddress, req, res, next);

    expect(deleteAddressService).toHaveBeenCalledWith(ADDRESS_ID, MERCHANT_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._body.message).toBe('Address deleted successfully');
  });

  test('calls next(error) with 404 when address not found', async () => {
    const err = Object.assign(new Error('Address not found'), { statusCode: 404 });
    deleteAddressService.mockRejectedValue(err);

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID } } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(deleteAddress, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  test('calls next(error) with 500 when soft-delete DB operation fails', async () => {
    const err = Object.assign(new Error('Failed to delete address'), { statusCode: 500 });
    deleteAddressService.mockRejectedValue(err);

    const req  = mockReq({ validated: { params: { id: ADDRESS_ID } } });
    const res  = mockRes();
    const next = mockNext();

    await callHandler(deleteAddress, req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });
});
