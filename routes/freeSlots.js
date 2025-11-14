const express = require('express');
const router = express.Router();
const { getFreeSlots } = require('../controllers/freeSlotsController');
const auth = require('../middleware/auth');
// --- MODIFIED --- Added 'auth' middleware
router.get('/', auth, getFreeSlots);

module.exports = router;