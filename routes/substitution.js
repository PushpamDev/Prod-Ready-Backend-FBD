const express = require('express');
const router = express.Router();

// Import all functions from the controller
const { 
    assignSubstitute, 
    mergeBatches, 
    createTemporarySubstitution,
    getActiveSubstitutions,
    updateSubstitution,
    cancelSubstitution
} = require('../controllers/substitutionController');

// --- NEW --- Import middleware
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// === Temporary Substitution Routes ===

// GET all active/upcoming temporary substitutions (for a dashboard)
// --- MODIFIED --- Added auth and admin
router.get('/temporary', auth, admin, getActiveSubstitutions);

// POST a new temporary substitution record (non-destructive)
// --- MODIFIED --- Added auth and admin
router.post('/temporary', auth, admin, createTemporarySubstitution);

// PUT (Update) an existing temporary substitution
// --- MODIFIED --- Added auth and admin
router.put('/temporary/:id', auth, admin, updateSubstitution);

// DELETE (Cancel) a temporary substitution
// --- MODIFIED --- Added auth and admin
router.delete('/temporary/:id', auth, admin, cancelSubstitution);


// === Permanent Action Routes ===

// POST for PERMANENTLY re-assigning a batch to a new faculty
// --- MODIFIED --- Added auth and admin
router.post('/assign', auth, admin, assignSubstitute);

// POST for PERMANENTLY merging two batches
// --- MODIFIED --- Added auth and admin
router.post('/merge', auth, admin, mergeBatches);


module.exports = router;