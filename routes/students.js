const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // Make sure to import auth

const { 
    getAllStudents, 
    createStudent, 
    updateStudent, 
    deleteStudent,
    getStudentBatches 
} = require('../controllers/studentsController');

// Standard CRUD routes with auth
router.get('/', auth, getAllStudents);
router.post('/', auth, createStudent);
router.put('/:id', auth, updateStudent);
router.delete('/:id', auth, deleteStudent);

// Route to get all batches for a specific student
router.get('/:id/batches', auth, getStudentBatches);

module.exports = router;