const express = require('express');
const router = express.Router();

// Import all three functions from the controller
const { 
    assignSubstitute, 
    mergeBatches, 
    createTemporarySubstitution 
} = require('../controllers/substitutionController');

// **NEW**: Route for creating a temporary leave/substitution record (non-destructive)
router.post('/temporary', createTemporarySubstitution);

// Route for PERMANENTLY re-assigning a batch to a new faculty
router.post('/assign', assignSubstitute);

// Route for PERMANENTLY merging two batches
router.post('/merge', mergeBatches);

module.exports = router;