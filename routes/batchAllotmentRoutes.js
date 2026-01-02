const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const controller = require('../controllers/batchAllotmentController');

router.get('/', auth, controller.getBatchAllotmentList);
router.put('/:admissionId', auth, controller.updateBatchAllotment);

module.exports = router;
