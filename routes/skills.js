const express = require('express');
const router = express.Router();
const skillsController = require('../controllers/skillsController');

// --- NEW --- Import middleware
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// --- MODIFIED ---
// All authenticated users (admin, faculty) can VIEW skills
router.get('/', auth, skillsController.getAllSkills);

// --- MODIFIED ---
// Only ADMINS can CREATE skills
router.post('/', auth, admin, skillsController.createSkill);

// --- MODIFIED ---
// Only ADMINS can UPDATE skills
router.put('/:id', auth, admin, skillsController.updateSkill);

// --- MODIFIED ---
// Only ADMINS can DELETE skills
router.delete('/:id', auth, admin, skillsController.deleteSkill);

module.exports = router;