const express = require('express');
const router = express.Router();
const { getAnnouncements, createAnnouncement, deleteAnnouncement } = require('../controllers/announcementController');

router.get('/', getAnnouncements);
router.post('/', createAnnouncement);
router.delete('/:id', deleteAnnouncement);

module.exports = router;