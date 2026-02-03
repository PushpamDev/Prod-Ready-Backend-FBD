// server/routes/announcementRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // Import your auth middleware
const { 
    getAnnouncements, 
    createAnnouncement, 
    deleteAnnouncement 
} = require('../controllers/announcementController');

// All announcement routes should be protected
router.get('/', auth, getAnnouncements);
router.post('/', auth, createAnnouncement);
router.delete('/:id', auth, deleteAnnouncement);

module.exports = router;