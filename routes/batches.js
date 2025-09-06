const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAllBatches, createBatch, updateBatch, deleteBatch, getBatchStudents } = require('../controllers/batchesController');

router.get('/', auth, getAllBatches);
router.post('/', auth, createBatch);
router.put('/:id', auth, updateBatch);
router.delete('/:id', auth, deleteBatch);
router.get('/:id/students', auth, getBatchStudents);

module.exports = router;