const express = require('express');
const router = express.Router();
const { getAllBatches, createBatch, updateBatch, deleteBatch, getBatchStudents } = require('../controllers/batchesController');

router.get('/', getAllBatches);
router.post('/', createBatch);
router.put('/:id', updateBatch);
router.delete('/:id', deleteBatch);
router.get('/:id/students', getBatchStudents);

module.exports = router;