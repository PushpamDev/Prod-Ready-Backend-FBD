const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  getAdmins,
  getTicketCategories,
  getChatMessages,     // NEW: Added to handle GET chat history
  postChatMessage,
  reopenTicket         // NEW: Added for the reopen functionality
} = require('../controllers/ticketManagementController.js');

// --- TICKET MANAGEMENT ROUTES ---

// @route   GET /api/tickets
router.get('/', auth, getAllTickets);

// @route   POST /api/tickets
router.post('/', auth, createTicket);

// @route   GET /api/tickets/categories
router.get('/categories', auth, getTicketCategories);

// @route   GET /api/tickets/admins
router.get('/admins', auth, getAdmins);

// @route   GET /api/tickets/:id
router.get('/:id', auth, getTicketById);

// @route   PATCH /api/tickets/:id
router.patch('/:id', auth, updateTicket);

// @route   DELETE /api/tickets/:id
router.delete('/:id', auth, deleteTicket);

// --- REOPEN ROUTE ---

// @route   POST /api/tickets/:id/reopen
// @desc    Reopens a resolved ticket
router.post('/:id/reopen', auth, reopenTicket);

// --- CHAT ROUTES ---

// @route   GET /api/tickets/:ticketId/chat
// @desc    Fetch all messages for a specific ticket
// FIXES: The 404 error for Chat GET requests
router.get('/:ticketId/chat', auth, getChatMessages);

// @route   POST /api/tickets/:ticketId/chat
// @desc    Post an admin reply (blocked if ticket is Resolved)
router.post('/:ticketId/chat', auth, postChatMessage);

module.exports = router;