const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { sendMessage, getMessages } = require('../controllers/chatController.js');

// @route   POST /api/chat/:ticketId
// @desc    Send a message in a ticket's chat
// @access  Private
router.post('/:ticketId',sendMessage);

// @route   GET /api/chat/:ticketId
// @desc    Get all messages for a specific ticket
// @access  Private
router.get('/:ticketId', getMessages);

module.exports = router;