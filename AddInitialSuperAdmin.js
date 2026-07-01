<<<<<<< Updated upstream
require('dotenv').config();
=======
>>>>>>> Stashed changes
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./src/modules/users/user.model');
const { UserRole } = require('./src/constants');

async function seed() {
<<<<<<< Updated upstream
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/vexaro';
  console.log(`Connecting to database at ${mongoUri}...`);
  await mongoose.connect(mongoUri);

  const adminEmail = 'vishwasgour2002@gmail.com';
  const existing = await User.findOne({ email: adminEmail });

  if (existing) {
    console.log('Super Admin user already exists.');
    await mongoose.connection.close();
    return;
  }

  const passwordHash = await bcrypt.hash(adminEmail, 12);

  await User.create({
    email: adminEmail,
=======
  await mongoose.connect('mongodb://localhost:27017/vexaro');

  const existing = await User.findOne({
    email: 'vishwasgour2002@gmail.com',
  });

  if (existing) {
    console.log('User already exists');
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash('vishwasgour2002@gmail.com', 12);

  await User.create({
    email: 'vishwasgour2002@gmail.com',
>>>>>>> Stashed changes
    passwordHash,
    role: UserRole.SUPER_ADMIN,
    isActive: true,
    mustChangeCredentials: false,
    firstName: 'Vishwas',
    lastName: 'Gour',
    phone: '9999999999',
    companyName: 'Vexaro',
    address: 'Bhopal',
  });

<<<<<<< Updated upstream
  console.log('Super Admin user created successfully.');
  await mongoose.connection.close();
}

seed().catch(async (err) => {
  console.error('Seeding failed:', err);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});
=======
  console.log('Super Admin created');
  process.exit(0);
}

seed().catch(console.error);
>>>>>>> Stashed changes
