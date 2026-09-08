const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { signup, login, me } = require('../controllers/authController');

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', requireAuth, me);

module.exports = router;
