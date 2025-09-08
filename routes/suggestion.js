const express = require('express');
const router = express.Router();
const suggestionController = require('../controllers/suggestionController');

// Route to get faculty suggestions for a batch
router.post('/suggest-faculty', suggestionController.suggestFaculty);

module.exports = router;