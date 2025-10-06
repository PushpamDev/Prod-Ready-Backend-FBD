const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAllBatches, createBatch, updateBatch, deleteBatch, getBatchStudents, getActiveStudentsCount } = require('../controllers/batchesController');

router.get('/', auth, getAllBatches);
router.get('/active-students-count', auth, getActiveStudentsCount);
router.post('/', auth, createBatch);
router.put('/:id', auth, updateBatch);
router.delete('/:id', auth, deleteBatch);
router.get('/:id/students', auth, getBatchStudents);

module.exports = router;