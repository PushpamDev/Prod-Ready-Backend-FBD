const express = require('express');
const router = express.Router();
const { getFreeSlots } = require('../controllers/freeSlotsController');

router.get('/', getFreeSlots);

module.exports = router;