const express = require('express');
const router = express.Router();
const suggestionController = require('../controllers/suggestionController');
const auth = require('../middleware/auth');
// Route to get faculty suggestions for a batch
// --- MODIFIED --- Added 'auth' middleware
router.post('/suggest-faculty', auth, suggestionController.suggestFaculty);

module.exports = router;