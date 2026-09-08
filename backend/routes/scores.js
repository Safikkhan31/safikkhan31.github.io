const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { submitScore, leaderboard } = require('../controllers/scoreController');

router.post('/', requireAuth, submitScore);
router.get('/leaderboard', leaderboard);

module.exports = router;
