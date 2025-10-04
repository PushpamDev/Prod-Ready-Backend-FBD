const supabase = require('../db');
const { logActivity } = require("./logActivity");

// Centralized error handler
const handleSupabaseError = (res, error, context) => {
  console.error(`Error ${context}:`, error);
  if (error.code === 'PGRST116') {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (error.message.includes('Assignee Error')) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: `Failed to ${context.toLowerCase()}` });
};

// --- REVERTED TO ORIGINAL ---
// This function no longer uses req.user, as requested.
const createTicket = async (req, res) => {
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
        priority: priority || 'Low',
        category: category || 'Other',
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

// --- NO CHANGES NEEDED ---
// This function already has excellent pagination.
const getAllTickets = async (req, res) => {
  try {
    const { status, search, category, page = 1, limit = 15 } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('tickets')
      .select(`
        id, title, description, status, priority, category, created_at, updated_at,
        student:students(id, name),
        assignee:users(id, username),
        assignee_id
      `, { count: 'exact' });

    if (status && status !== 'All') {
      query = query.eq('status', status);
    }
    
    if (category && category !== 'All') {
      query = query.eq('category', category);
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

  const updatePayload = {};

  if (status) {
    if (status !== 'Resolved') {
      return res.status(403).json({ 
        error: "Forbidden: Only 'Resolved' status can be set manually. Status changes to 'In Progress' are automatic." 
      });
    }
    updatePayload.status = status;
  }
  
  if (assignee_id !== undefined) {
    updatePayload.assignee_id = assignee_id;
  }
  
  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ error: "No valid fields to update were provided." });
  }
  
  try {
    if ('assignee_id' in updatePayload) {
      const { data: currentUser, error: userError } = await supabase
        .from('users').select('username').eq('id', req.user.id).single();
      if (userError) throw userError;

      const { data: currentTicket, error: ticketError } = await supabase
        .from('tickets').select('assignee_id').eq('id', id).single();
      if (ticketError) throw ticketError;

      if (currentTicket.assignee_id && currentUser.username !== 'pushpam') {
        return res.status(403).json({ 
          error: "Forbidden: This ticket is already assigned and can only be reassigned by the super-admin." 
        });
      }
    }
    
    updatePayload.updated_at = new Date();
    const { data: ticket, error } = await supabase
      .from('tickets')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) return handleSupabaseError(res, error, `updating ticket ${id}`);

    const logMessage = status === 'Resolved' 
      ? `Ticket "${ticket.title}" was marked as Resolved.`
      : `Ticket "${ticket.title}" assignment was updated.`;
    await logActivity("Updated", logMessage, req.user.id);

    res.status(200).json(ticket);

  } catch (error) {
    console.error(`Internal server error while updating ticket ${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const deleteTicket = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: ticket, error } = await supabase.from('tickets').delete().eq('id', id).select().single();
    if (error) return handleSupabaseError(res, error, `deleting ticket ${id}`);
    await logActivity("Deleted", `Ticket "${ticket.title}" (ID: ${id}) was deleted.`, "system");
    res.status(204).send();
  } catch (error) {
    console.error(`Internal server error while deleting ticket ${id}:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// --- CORRECTED FUNCTION ---
// Added a pagination loop to ensure all admins are always fetched.
const getAdmins = async (req, res) => {
  try {
    const allAdmins = [];
    const pageSize = 1000;
    let page = 0;
    let moreDataAvailable = true;

    while (moreDataAvailable) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('users')
        .select('id, username')
        .eq('role', 'admin')
        .range(from, to);

      if (error) return handleSupabaseError(res, error, 'fetching admins');
      
      if (data) {
        allAdmins.push(...data);
      }
      
      if (!data || data.length < pageSize) {
        moreDataAvailable = false;
      }
      page++;
    }
    
    res.status(200).json(allAdmins);

  } catch (error) {
    console.error("Internal server error while fetching admins:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getTicketCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .rpc('get_unique_ticket_categories')
      .limit(2000); // Added a generous limit as a safeguard for RPC calls.
      
    if (error) return handleSupabaseError(res, error, 'fetching ticket categories');
    const categories = data.map(item => item.category);
    res.status(200).json(categories);
  } catch (error) {
     console.error("Internal server error while fetching ticket categories:", error);
     res.status(500).json({ error: "Internal server error" });
  }
};

const postChatMessage = async (req, res) => {
    const { ticketId } = req.params;
    const { message } = req.body;
    const sender_user_id = req.user.id; 

    if (!message) {
        return res.status(400).json({ error: 'Message content cannot be empty.' });
    }

    try {
        const { data: newMessage, error } = await supabase.rpc('send_admin_reply_and_update_status', {
            p_ticket_id: ticketId,
            p_sender_user_id: sender_user_id,
            p_message: message
        });

        if (error) return handleSupabaseError(res, error, 'posting chat message');

        await logActivity("Replied", `Admin replied to ticket ID ${ticketId}`, sender_user_id);
        
        res.status(201).json(newMessage);
    } catch (error) {
        console.error(`Internal server error while posting message to ticket ${ticketId}:`, error);
        res.status(500).json({ error: "Internal server error" });
    }
};


module.exports = {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  getAdmins,
  getTicketCategories,
  postChatMessage,
};