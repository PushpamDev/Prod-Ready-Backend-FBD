const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // Assuming your auth middleware is here
const {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
} = require('../controllers/ticketManagementController.js')

// @route   GET /api/tickets
// @desc    Get all tickets with filtering, searching, and pagination
// @access  Private
router.get('/', getAllTickets);

// @route   POST /api/tickets
// @desc    Create a new ticket
// @access  Private
router.post('/', createTicket);

// @route   GET /api/tickets/:id
// @desc    Get a single ticket by its ID
// @access  Private
router.get('/:id', getTicketById);

// @route   PATCH /api/tickets/:id
// @desc    Update a ticket's status or assignee
// @access  Private
router.patch('/:id', auth, updateTicket);

// @route   DELETE /api/tickets/:id
// @desc    Delete a ticket by its ID
// @access  Private
router.delete('/:id', auth, deleteTicket);

module.exports = router;

