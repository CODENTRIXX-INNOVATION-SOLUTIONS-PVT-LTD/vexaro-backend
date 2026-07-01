'use strict';

const axios = require('axios');
const { env } = require('../config/env');
const logger = require('./logger');

let _token = null;
let _tokenExpiresAt = null;

const getToken = async () => {
  const now = Date.now();
  // checks if _token exists AND _tokenExpiresAt is more than 30 minutes in the future (30 minutes = 1,800,000 ms)
  if (_token && _tokenExpiresAt && (_tokenExpiresAt - now > 30 * 60 * 1000)) {
    return _token;
  }

  try {
    const response = await axios.post(
      `${env.VELOCITY_BASE_URL}custom/api/v1/auth-token`,
      { username: env.VELOCITY_USERNAME, password: env.VELOCITY_PASSWORD },
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (response.data && response.data.token) {
      _token = response.data.token;
      _tokenExpiresAt = now + 24 * 60 * 60 * 1000; // 24 hours expiry
      logger.debug('velocity_token_cached', { expiresAt: new Date(_tokenExpiresAt) });
      return _token;
    }
    throw new Error('Token not found in response');
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.error('velocity_auth_failed', { error: detail });
    throw Object.assign(new Error(`Velocity authentication failed: ${detail}`), { statusCode: 503 });
  }
};

const velocityCall = async (apiPath, method = 'POST', data = null) => {
  const token = await getToken();
  try {
    const response = await axios({
      url: `${env.VELOCITY_BASE_URL}${apiPath}`,
      method,
      data,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      }
    });
    return response.data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw Object.assign(new Error(`Velocity API call failed: ${detail}`), { statusCode: err.response?.status || 502 });
  }
};

const createWarehouse = async (warehouse, merchantName = '') => {
  const payload = {
    name: warehouse.name || merchantName || `Warehouse-${warehouse.warehouseId}`,
    phone_number: warehouse.phone || '',
    email: warehouse.email || 'warehouse@vexaro.in',
    contact_person: warehouse.contactPerson,
    gst_no: warehouse.gstNo || undefined,
    address_attributes: {
      street_address: warehouse.address,
      zip: warehouse.pincode,
      city: warehouse.city,
      state: warehouse.state,
      country: warehouse.country || 'India',
    },
  };
  const data = await velocityCall('custom/api/v1/warehouse', 'POST', payload);
  if (data && data.status === 'SUCCESS') {
    return data.payload.warehouse_id;
  }
  throw new Error(data?.message || 'Velocity returned non-SUCCESS status');
};

const checkServiceability = async (fromPincode, toPincode, isCOD = false, isForward = true) => {
  const payload = {
    from: fromPincode.toString(),
    to: toPincode.toString(),
    payment_mode: isCOD ? 'cod' : 'prepaid',
    shipment_type: isForward ? 'forward' : 'return',
  };
  const data = await velocityCall('custom/api/v1/serviceability', 'POST', payload);
  if (data && data.status === 'SUCCESS') {
    return {
      carriers: data.result.serviceability_results || [],
      zone: data.result.zone || null,
    };
  }
  throw new Error(data?.message || 'Serviceability check returned non-SUCCESS status');
};

const createForwardOrder = async (shipment, merchant, warehouse, carrierId = '') => {
  const nameParts = shipment.destination.name.split(' ');
  const firstName = nameParts[0] || shipment.destination.name;
  const lastName = nameParts.slice(1).join(' ') || '';

  const orderDate = new Date(shipment.createdAt)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');

  const velocityWHId = warehouse.velocityWarehouseId;
  if (!velocityWHId) {
    throw Object.assign(
      new Error(`Warehouse "${warehouse.warehouseId}" has not been synced to Velocity.`),
      { statusCode: 422 }
    );
  }

  const payload = {
    order_id: shipment.merchantOrderRef || shipment.awb,
    order_date: orderDate,
    carrier_id: carrierId || undefined,

    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: shipment.destination.addressLine,
    billing_city: shipment.destination.city,
    billing_pincode: shipment.destination.pincode,
    billing_state: shipment.destination.state,
    billing_country: shipment.destination.country || 'India',
    billing_phone: shipment.destination.phone,
    billing_email: merchant.email,

    shipping_is_billing: true,
    print_label: true,

    order_items: [{
      name: shipment.notes || 'Courier Parcel',
      sku: shipment.merchantOrderRef || `VX-${shipment.awb}`,
      units: 1,
      selling_price: shipment.declaredValue || 1,
      discount: 0,
      tax: 0,
    }],

    payment_method: shipment.isCOD ? 'COD' : 'PREPAID',
    sub_total: shipment.declaredValue || 0,
    cod_collectible: shipment.isCOD ? (shipment.codAmount || 0) : 0,

    length: shipment.length || 10,
    breadth: shipment.breadth || 10,
    height: shipment.height || 10,
    weight: shipment.weight || 0.5,

    pickup_location: velocityWHId,
    warehouse_id: velocityWHId,

    vendor_details: {
      email: merchant.email,
      phone: warehouse.phone || merchant.phone || '9999999999',
      name: merchant.companyName || `${merchant.firstName} ${merchant.lastName}`,
      address: warehouse.address,
      city: warehouse.city,
      state: warehouse.state,
      country: warehouse.country || 'India',
      pin_code: warehouse.pincode,
      pickup_location: velocityWHId,
    },
  };

  const data = await velocityCall('custom/api/v1/forward-order-orchestration', 'POST', payload);
  if (data && data.status === 1) {
    const p = data.payload;
    logger.info('velocity_forward_order_booked', {
      awb: p.awb_code,
      velocityOrderId: p.order_id,
      carrierName: p.courier_name,
      merchantOrderRef: shipment.merchantOrderRef || null,
    });
    return {
      awb: p.awb_code,
      shipmentId: p.shipment_id,
      velocityOrderId: p.order_id,
      carrierName: p.courier_name,
      carrierId: p.courier_company_id,
      labelUrl: p.label_url || null,
      charges: p.charges || null,
    };
  }
  throw new Error(data?.message || `Velocity returned status ${data?.status}`);
};

const createReverseOrder = async (dto, velocityWarehouseId, carrierId = '') => {
  if (!velocityWarehouseId) {
    throw Object.assign(
      new Error('Destination warehouse has not been synced to Velocity.'),
      { statusCode: 422 }
    );
  }

  const orderDate = new Date()
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');

  const payload = {
    order_id: dto.orderId,
    order_date: dto.orderDate || orderDate,
    carrier_id: carrierId || undefined,

    pickup_customer_name: dto.pickupFirstName,
    pickup_last_name: dto.pickupLastName || '',
    company_name: dto.companyName || '',
    pickup_address: dto.pickupAddress,
    pickup_address_2: dto.pickupAddress2 || '',
    pickup_city: dto.pickupCity,
    pickup_state: dto.pickupState,
    pickup_country: dto.pickupCountry || 'India',
    pickup_pincode: dto.pickupPincode,
    pickup_email: dto.pickupEmail || '',
    pickup_phone: dto.pickupPhone,
    pickup_isd_code: dto.pickupIsdCode || '91',

    shipping_customer_name: dto.shippingFirstName,
    shipping_last_name: dto.shippingLastName || '',
    shipping_address: dto.shippingAddress,
    shipping_address_2: dto.shippingAddress2 || '',
    shipping_city: dto.shippingCity,
    shipping_state: dto.shippingState,
    shipping_country: dto.shippingCountry || 'India',
    shipping_pincode: dto.shippingPincode,
    shipping_email: dto.shippingEmail || '',
    shipping_phone: dto.shippingPhone,
    shipping_isd_code: dto.shippingIsdCode || '91',

    warehouse_id: velocityWarehouseId,

    order_items: dto.orderItems,
    payment_method: 'PREPAID',
    total_discount: dto.totalDiscount || 0,
    sub_total: dto.subTotal,

    length: dto.length,
    breadth: dto.breadth,
    height: dto.height,
    weight: dto.weight,
    request_pickup: dto.requestPickup !== false,
  };

  const data = await velocityCall('custom/api/v1/reverse-order-orchestration', 'POST', payload);
  if (data && data.status === 1) {
    const p = data.payload;
    logger.info('velocity_reverse_order_booked', {
      awb: p.awb_code,
      velocityOrderId: p.order_id,
      carrierName: p.courier_name,
    });
    return {
      awb: p.awb_code,
      shipmentId: p.shipment_id,
      velocityOrderId: p.order_id,
      carrierName: p.courier_name,
      carrierId: p.courier_company_id,
      charges: p.charges || null,
    };
  }
  throw new Error(data?.message || `Velocity returned status ${data?.status}`);
};

const cancelOrder = async (awb) => {
  const awbs = Array.isArray(awb) ? awb : [awb];
  const data = await velocityCall('custom/api/v1/cancel-order', 'POST', { awbs });
  logger.info('velocity_cancel_requested', { awbs, message: data?.message });
  return data?.message || 'Cancellation request submitted';
};

const cancelOrders = cancelOrder;

const trackOrders = async (awb) => {
  const awbs = Array.isArray(awb) ? awb : [awb];
  const data = await velocityCall('custom/api/v1/order-tracking', 'POST', { awbs });
  return data?.result || {};
};

const getTrackingDetails = trackOrders;

const getRates = async (params) => {
  const payload = {
    journey_type: params.journeyType,
    origin_pincode: params.originPincode.toString(),
    destination_pincode: params.destinationPincode.toString(),
    dead_weight: params.deadWeight,
    length: params.length,
    width: params.width,
    height: params.height,
  };

  if (params.journeyType === 'forward') {
    payload.payment_method = params.paymentMethod;
    if (params.paymentMethod === 'cod') {
      payload.shipment_value = params.shipmentValue;
    }
  }

  if (params.journeyType === 'return') {
    payload.qc_applicable = params.qcApplicable !== false;
  }

  const data = await velocityCall('custom/api/v1/rates', 'POST', payload);
  if (data && data.status === 'SUCCESS') {
    return data.result;
  }
  throw new Error(data?.message || 'Velocity rates API returned non-SUCCESS status');
};

const getShipments = async () => {
  return [];
};

const getSummaryReport = async (startDateTime, endDateTime, shipmentType) => {
  const payload = {
    start_date_time: startDateTime,
    end_date_time: endDateTime,
    shipment_type: shipmentType,
  };
  const data = await velocityCall('custom/api/v1/reports', 'POST', payload);
  if (data && data.status === 'SUCCESS') {
    return data.payload;
  }
  throw new Error(data?.message || 'Velocity reports API returned non-SUCCESS status');
};

const velocityClient = {
  createWarehouse,
  checkServiceability,
  createForwardOrder,
  createReverseOrder,
  cancelOrder,
  cancelOrders,
  trackOrders,
  getTrackingDetails,
  getRates,
  getShipments,
  getSummaryReport,
  getAuthToken: getToken,
};

module.exports = {
  createWarehouse,
  checkServiceability,
  createForwardOrder,
  createReverseOrder,
  cancelOrder,
  cancelOrders,
  trackOrders,
  getTrackingDetails,
  getRates,
  getShipments,
  getSummaryReport,
  velocityClient,
};
