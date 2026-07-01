const mongoose = require('mongoose');
const { Shipment } = require('./src/modules/shipments/shipment.model');
const { User } = require('./src/modules/users/user.model');
const {
  ShipmentStatus,
  ShipmentServiceType,
  ShipmentCODStatus,
  ShipmentPayoutStatus,
} = require('./src/constants');

function history(statuses, userId) {
  const now = new Date();
  const hourOffsets = {
    [ShipmentStatus.ORDER_CREATED]: 48,
    [ShipmentStatus.PICKED_UP]: 40,
    [ShipmentStatus.ARRIVED_AT_HUB]: 24,
    [ShipmentStatus.OUT_FOR_DELIVERY]: 8,
    [ShipmentStatus.DELIVERED]: 1,
    [ShipmentStatus.DELIVERY_FAILED]: 1,
  };

  return statuses.map((status) => ({
    status,
    timestamp: new Date(now.getTime() - 1000 * 60 * 60 * (hourOffsets[status] || 0)),
    note: `Status updated to ${status}`,
    updatedBy: userId,
  }));
}

async function seedShipments() {
  try {
    await mongoose.connect('mongodb://localhost:27017/vexaro');
    console.log('✅ MongoDB Connected');

    const merchant = await User.findOne();

    if (!merchant) {
      console.log('❌ No user found. Please create a merchant/user first.');
      process.exit(0);
    }

    const now = new Date();

    // ---------- Multiple shipment variants ----------
    const shipments = [
      {
        awb: 'VX-TRACK-1001',
        merchantOrderRef: 'ORD-1001',
        invoiceNumber: 'INV-1001',
        status: ShipmentStatus.ORDER_CREATED,
        statusHistory: history([ShipmentStatus.ORDER_CREATED], merchant._id),
      },
      {
        awb: 'VX-TRACK-1002',
        merchantOrderRef: 'ORD-1002',
        invoiceNumber: 'INV-1002',
        status: ShipmentStatus.PICKED_UP,
        statusHistory: history(
          [ShipmentStatus.ORDER_CREATED, ShipmentStatus.PICKED_UP],
          merchant._id
        ),
      },
      {
        awb: 'VX-TRACK-1003',
        merchantOrderRef: 'ORD-1003',
        invoiceNumber: 'INV-1003',
        status: ShipmentStatus.ARRIVED_AT_HUB,
        statusHistory: history(
          [
            ShipmentStatus.ORDER_CREATED,
            ShipmentStatus.PICKED_UP,
            ShipmentStatus.ARRIVED_AT_HUB,
          ],
          merchant._id
        ),
      },
      {
        awb: 'VX-TRACK-1004',
        merchantOrderRef: 'ORD-1004',
        invoiceNumber: 'INV-1004',
        status: ShipmentStatus.OUT_FOR_DELIVERY,
        statusHistory: history(
          [
            ShipmentStatus.ORDER_CREATED,
            ShipmentStatus.PICKED_UP,
            ShipmentStatus.ARRIVED_AT_HUB,
            ShipmentStatus.OUT_FOR_DELIVERY,
          ],
          merchant._id
        ),
      },
      {
        awb: 'VX-TRACK-1005',
        merchantOrderRef: 'ORD-1005',
        invoiceNumber: 'INV-1005',
        status: ShipmentStatus.DELIVERED,
        deliveredAt: new Date(),
        codCollected: 2500,
        codStatus: ShipmentCODStatus.COLLECTED,
        payoutStatus: ShipmentPayoutStatus.COMPLETED,
        payoutDate: new Date(),
        statusHistory: history(
          [
            ShipmentStatus.ORDER_CREATED,
            ShipmentStatus.PICKED_UP,
            ShipmentStatus.ARRIVED_AT_HUB,
            ShipmentStatus.OUT_FOR_DELIVERY,
            ShipmentStatus.DELIVERED,
          ],
          merchant._id
        ),
      },
      {
        awb: 'VX-TRACK-1006',
        merchantOrderRef: 'ORD-1006',
        invoiceNumber: 'INV-1006',
        status: ShipmentStatus.DELIVERY_FAILED,
        statusHistory: history(
          [
            ShipmentStatus.ORDER_CREATED,
            ShipmentStatus.PICKED_UP,
            ShipmentStatus.ARRIVED_AT_HUB,
            ShipmentStatus.OUT_FOR_DELIVERY,
            ShipmentStatus.DELIVERY_FAILED,
          ],
          merchant._id
        ),
      },
    ];

    // Shared defaults applied to every shipment above
    const sharedDefaults = {
      merchantId: merchant._id,
      distributorId: null,
      warehouseId: null,
      origin: {
        name: 'Vexaro Warehouse',
        phone: '9999999999',
        addressLine: 'Plot No. 101, Industrial Area',
        city: 'Bhopal',
        state: 'Madhya Pradesh',
        pincode: '462001',
        country: 'India',
      },
      destination: {
        name: 'Rahul Sharma',
        phone: '8888888888',
        addressLine: 'Flat 201, Vijay Nagar',
        city: 'Indore',
        state: 'Madhya Pradesh',
        pincode: '452001',
        country: 'India',
      },
      weight: 2.5,
      declaredWeight: 2.5,
      length: 30,
      breadth: 20,
      height: 15,
      declaredValue: 2500,
      isCOD: true,
      codAmount: 2500,
      carrierCost: 120,
      distributorCost: 150,
      merchantCost: 180,
      serviceType: ShipmentServiceType.STANDARD,
      carrier: 'Delhivery',
      carrierAWB: null,
      estimatedDelivery: new Date(now.getTime() + 1000 * 60 * 60 * 48),
      notes: 'Seeded test shipment',
      velocityShipmentId: null,
      velocityOrderId: null,
      velocityReturnId: null,
      velocityBooked: true,
      velocityBookedAt: new Date(now.getTime() - 1000 * 60 * 60 * 47),
      labelUrl: null,
      isReturn: false,
    };

    let created = 0;
    let skipped = 0;

    for (const shipment of shipments) {
      const existing = await Shipment.findOne({ awb: shipment.awb });
      if (existing) {
        console.log(`⚠️  Skipped (already exists): ${shipment.awb}`);
        skipped++;
        continue;
      }

      await Shipment.create({ ...sharedDefaults, ...shipment });
      console.log(`✅ Created: ${shipment.awb} — ${shipment.status}`);
      created++;
    }

    // ---------- Fully detailed single shipment ----------
    const detailedAWB = 'VX-20260701-TRACK01';
    const existingDetailed = await Shipment.findOne({ awb: detailedAWB });

    if (existingDetailed) {
      console.log(`⚠️  Skipped (already exists): ${detailedAWB}`);
      skipped++;
    } else {
      const detailed = await Shipment.create({
        awb: detailedAWB,
        merchantId: merchant._id,
        distributorId: null,
        warehouseId: null,
        origin: {
          name: 'Vexaro Warehouse',
          phone: '9999999999',
          addressLine: 'Plot No. 101, Industrial Area',
          city: 'Bhopal',
          state: 'Madhya Pradesh',
          pincode: '462001',
          country: 'India',
        },
        destination: {
          name: 'Rahul Sharma',
          phone: '8888888888',
          addressLine: 'Flat 201, Vijay Nagar',
          city: 'Indore',
          state: 'Madhya Pradesh',
          pincode: '452001',
          country: 'India',
        },
        weight: 2.5,
        declaredWeight: 2.5,
        length: 30,
        breadth: 20,
        height: 15,
        declaredValue: 2500,
        isCOD: true,
        codAmount: 2500,
        codCollected: 2500,
        codStatus: ShipmentCODStatus.COLLECTED,
        payoutStatus: ShipmentPayoutStatus.COMPLETED,
        payoutDate: new Date(now.getTime() - 1000 * 60 * 60 * 2),
        carrierCost: 120,
        distributorCost: 150,
        merchantCost: 180,
        serviceType: ShipmentServiceType.STANDARD,
        status: ShipmentStatus.DELIVERED,
        statusHistory: [
          {
            status: ShipmentStatus.ORDER_CREATED,
            timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 48),
            note: 'Order created by merchant',
            updatedBy: merchant._id,
          },
          {
            status: ShipmentStatus.PICKED_UP,
            timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 40),
            note: 'Shipment picked up',
            updatedBy: merchant._id,
          },
          {
            status: ShipmentStatus.ARRIVED_AT_HUB,
            timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 24),
            note: 'Reached sorting hub',
            updatedBy: merchant._id,
          },
          {
            status: ShipmentStatus.OUT_FOR_DELIVERY,
            timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 8),
            note: 'Out for delivery',
            updatedBy: merchant._id,
          },
          {
            status: ShipmentStatus.DELIVERED,
            timestamp: new Date(now.getTime() - 1000 * 60 * 60),
            note: 'Delivered successfully',
            updatedBy: merchant._id,
          },
        ],
        carrier: 'Delhivery',
        carrierAWB: 'DL9876543210',
        estimatedDelivery: new Date(now.getTime() - 1000 * 60 * 60),
        deliveredAt: new Date(now.getTime() - 1000 * 60 * 60),
        notes: 'Successfully delivered test shipment.',
        merchantOrderRef: 'ORDER-10001',
        invoiceNumber: 'INV-10001',
        velocityShipmentId: 'VEL-SHIP-10001',
        velocityOrderId: 'VEL-ORDER-10001',
        velocityReturnId: null,
        velocityBooked: true,
        velocityBookedAt: new Date(now.getTime() - 1000 * 60 * 60 * 47),
        labelUrl: 'https://example.com/labels/VX-20260701-TRACK01.pdf',
        isReturn: false,
      });

      console.log(`✅ Created (detailed): ${detailed.awb} — ${detailed.status}`);
      created++;
    }

    console.log(`\n🎯 Done — Created: ${created}, Skipped: ${skipped}`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seedShipments();