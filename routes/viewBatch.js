const express = require('express');
const router = express.Router();
const { getAllBatches, getBatchStudents } = require('../controllers/batchesController');

router.get('/', getAllBatches);
router.get('/:id/students', getBatchStudents);

module.exports = router;