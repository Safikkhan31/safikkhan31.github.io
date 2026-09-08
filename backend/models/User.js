const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
    },
    passwordHash: {
      type: String,
      required: true,
    },
    highScore: {
      type: Number,
      default: 0,
    },
    totalBounces: {
      type: Number,
      default: 0,
    },
    gamesPlayed: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Case-insensitive uniqueness lookups are handled at the controller level
// by always querying/storing username in lowercase.
userSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
