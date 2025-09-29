const supabase = require('../db');
const { logActivity } = require("./logActivity");

// Centralized error handler
const handleSupabaseError = (res, error, context) => {
  console.error(`Error ${context}:`, error);
  // Handle specific Supabase/PostgREST errors
  if (error.code === 'PGRST116') { // "Not a single row was returned"
    return res.status(404).json({ error: "Ticket not found" });
  }
  // Custom error from our trigger
  if (error.message.includes('Assignee Error')) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: `Failed to ${context.toLowerCase()}` });
};

// This function is for a STUDENT creating a ticket.
const createTicket = async (req, res) => {
  // ALIGNED: Now accepts priority and category from the request body.
  const { title, description, student_id, priority, category } = req.body;

  if (!title || !description || !student_id) {
    return res.status(400).json({ error: "Title, description, and student creator are required" });
  }

  try {
    const { data: ticket, error } = await supabase
      .from('tickets')
      .insert([{ 
        title, 
        description, 
        student_id,
        priority: priority || 'Low', // Default to 'Low' if not provided
        category: category || 'General', // Default category
        status: 'Open' 
      }])
      .select()
      .single();

    if (error) return handleSupabaseError(res, error, 'creating ticket');

    await logActivity("Created", `Ticket "${ticket.title}" created by student ID ${student_id}`, "system");

    res.status(201).json(ticket);
  } catch (error) {
    console.error("Internal server error during ticket creation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getAllTickets = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 15 } = req.query; // ALIGNED: Default limit to 15
    const offset = (page - 1) * limit;

    let query = supabase
      .from('tickets')
      // ALIGNED: Selects all necessary fields and nested objects for the frontend
      .select(`
        id, title, description, status, priority, category, created_at, updated_at,
        student:students(id, name),
        assignee:users(id, username),
        assignee_id
      `, { count: 'exact' });

    if (status && status !== 'All') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }
    
    query = query.order('created_at', { ascending: false });
    query = query.range(offset, offset + limit - 1);

    const { data: tickets, error, count } = await query;

    if (error) return handleSupabaseError(res, error, 'fetching tickets');

    res.status(200).json({
      items: tickets,
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

  } catch (error) {
     console.error("Internal server error while getting tickets:", error);
     res.status(500).json({ error: "Internal server error" });
  }
};

const getTicketById = async (req, res) => {
  const { id } = req.params;

  try {
    // ALIGNED: Selects all fields to hydrate the details view
    const { data: ticket, error } = await supabase
      .from('tickets')
      .select(`
        id, title, description, status, priority, category, created_at, updated_at,
        student:students(id, name),
        assignee:users(id, username),
        assignee_id
      `)
      .eq('id', id)
      .single();

    if (error) return handleSupabaseError(res, error, `fetching ticket ${id}`);
    
    res.status(200).json(ticket);
  } catch (error) {
     console.error(`Internal server error while getting ticket ${id}:`, error);
     res.status(500).json({ error: "Internal server error" });
  }
};

const updateTicket = async (req, res) => {
  const { id } = req.params;
  const { assignee_id, status } = req.body;

  // IMPROVEMENT: Dynamically build the payload for a true PATCH operation
  const updatePayload = {};
  if (assignee_id !== undefined) {
    updatePayload.assignee_id = assignee_id;
  }
  if (status) {
    updatePayload.status = status;
  }
  
  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ error: "No fields to update provided." });
  }
  
  updatePayload.updated_at = new Date();

  try {
    const { data: ticket, error } = await supabase
      .from('tickets')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) return handleSupabaseError(res, error, `updating ticket ${id}`);

    await logActivity("Updated", `Ticket "${ticket.title}" was updated.`, "system");

    res.status(200).json(ticket);
  } catch (error) {
    console.error(`Internal server error while updating ticket ${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const deleteTicket = async (req, res) => {
  const { id } = req.params;
  
  try {
    const { data: ticket, error } = await supabase
      .from('tickets')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) return handleSupabaseError(res, error, `deleting ticket ${id}`);

    await logActivity("Deleted", `Ticket "${ticket.title}" (ID: ${id}) was deleted.`, "system");

    res.status(204).send();
  } catch (error) {
    console.error(`Internal server error while deleting ticket ${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// NEW: Function to get only admin users for the assignee dropdown
const getAdmins = async (req, res) => {
  try {
    const { data: admins, error } = await supabase
      .from('users')
      .select('id, username')
      .eq('role', 'admin');

    if (error) return handleSupabaseError(res, error, 'fetching admins');

    res.status(200).json(admins);
  } catch (error) {
    console.error("Internal server error while fetching admins:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  getAdmins, // EXPORTED: New function
};
