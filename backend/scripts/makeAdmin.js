// One-off CLI script to promote an existing account to 'admin'.
// Deliberately NOT an API endpoint — promoting via a signup/login field
// would let anyone grant themselves admin. This requires direct database
// access (i.e., whoever runs the backend), which is the appropriate bar
// for a role that unlocks debug tooling like the ball trajectory overlay.
//
// Usage (run from the backend/ directory, with .env already configured):
//   node scripts/makeAdmin.js <username>
//   node scripts/makeAdmin.js <username> --revoke   (to demote back to 'user')

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  const username = process.argv[2];
  const revoke = process.argv.includes('--revoke');

  if (!username) {
    console.error('Usage: node scripts/makeAdmin.js <username> [--revoke]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const user = await User.findOne({ username: username.toLowerCase() });
  if (!user) {
    console.error(`No user found with username "${username}".`);
    await mongoose.disconnect();
    process.exit(1);
  }

  user.role = revoke ? 'user' : 'admin';
  await user.save();

  console.log(`"${user.username}" is now role: ${user.role}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
