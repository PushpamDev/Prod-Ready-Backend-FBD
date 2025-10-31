const express = require('express');
const router = express.Router();

// Import all functions from the controller
const { 
    assignSubstitute, 
    mergeBatches, 
    createTemporarySubstitution,
    getActiveSubstitutions,  // <-- NEW
    updateSubstitution,        // <-- NEW
    cancelSubstitution         // <-- NEW
} = require('../controllers/substitutionController');


// === Temporary Substitution Routes ===

// GET all active/upcoming temporary substitutions (for a dashboard)
router.get('/temporary', getActiveSubstitutions);

// POST a new temporary substitution record (non-destructive)
router.post('/temporary', createTemporarySubstitution);

// PUT (Update) an existing temporary substitution (e.g., change dates or faculty)
// :id here refers to the ID of the 'faculty_substitutions' record
router.put('/temporary/:id', updateSubstitution);

// DELETE (Cancel) a temporary substitution
// :id here refers to the ID of the 'faculty_substitutions' record
router.delete('/temporary/:id', cancelSubstitution);


// === Permanent Action Routes ===

// POST for PERMANENTLY re-assigning a batch to a new faculty
router.post('/assign', assignSubstitute);

// POST for PERMANENTLY merging two batches
router.post('/merge', mergeBatches);


module.exports = router;