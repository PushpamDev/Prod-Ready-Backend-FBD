const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // Assuming your auth middleware is here
const {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  getAdmins,           // NEW: Added for admin assignment dropdown
  getTicketCategories, 
  postChatMessage,     // NEW: Added for admin replies
} = require('../controllers/ticketManagementController.js');

// --- TICKET MANAGEMENT ROUTES ---

// @route   GET /api/tickets
// @desc    Get all tickets with filtering, searching (by title/student), and pagination
router.get('/', auth, getAllTickets);

// @route   POST /api/tickets
// @desc    Create a new ticket (Automatically defaults to Medium priority)
router.post('/', auth, createTicket);

// @route   GET /api/tickets/categories
// @desc    Get a unique list of all ticket categories for the current location
router.get('/categories', auth, getTicketCategories);

// @route   GET /api/tickets/admins
// @desc    Get all admins for the current location (Used for assignment dropdown)
router.get('/admins', auth, getAdmins);

// @route   GET /api/tickets/:id
// @desc    Get a single ticket by its ID
router.get('/:id', auth, getTicketById);

// @route   PATCH /api/tickets/:id
// @desc    Update a ticket's status, assignee, or priority (Admin only)
router.patch('/:id', auth, updateTicket);

// @route   DELETE /api/tickets/:id
// @desc    Delete a ticket by its ID
router.delete('/:id', auth, deleteTicket);

// --- CHAT ROUTES ---

// @route   POST /api/tickets/:ticketId/messages
// @desc    Post a reply from the admin and automatically update status to 'In Progress'
router.post('/:ticketId/messages', auth, postChatMessage);

module.exports = router;