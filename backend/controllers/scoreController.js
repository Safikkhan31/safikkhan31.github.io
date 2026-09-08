const User = require('../models/User');

// Submit the result of a run. Only updates highScore if the new height is
// higher than what's stored — the server is the source of truth, never trust
// the client's "best" blindly for ranking purposes beyond this check.
exports.submitScore = async (req, res) => {
  try {
    const { height, bounces, final } = req.body;

    if (typeof height !== 'number' || Number.isNaN(height) || height < 0) {
      return res.status(400).json({ message: 'height must be a non-negative number.' });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const roundedHeight = Math.round(height);
    const isNewHighScore = roundedHeight > user.highScore;

    if (isNewHighScore) user.highScore = roundedHeight;

    // "final" marks the end of a full run (a win). Mid-run progress pings
    // (sent whenever the player passes a checkpoint higher than their
    // previous best) only update highScore — they shouldn't inflate
    // gamesPlayed/totalBounces every time someone climbs a bit higher.
    if (final) {
      if (typeof bounces === 'number' && bounces >= 0) {
        user.totalBounces += Math.round(bounces);
      }
      user.gamesPlayed += 1;
    }
    await user.save();

    res.json({
      isNewHighScore,
      highScore: user.highScore,
      gamesPlayed: user.gamesPlayed,
      totalBounces: user.totalBounces,
    });
  } catch (err) {
    console.error('Submit score error:', err);
    res.status(500).json({ message: 'Something went wrong while saving your score.' });
  }
};

exports.leaderboard = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const topUsers = await User.find({})
      .sort({ highScore: -1 })
      .limit(limit)
      .select('username highScore gamesPlayed');

    res.json({
      leaderboard: topUsers.map((u, i) => ({
        rank: i + 1,
        username: u.username,
        highScore: u.highScore,
        gamesPlayed: u.gamesPlayed,
      })),
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ message: 'Something went wrong while fetching the leaderboard.' });
  }
};
