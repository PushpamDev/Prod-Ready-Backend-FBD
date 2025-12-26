const supabase = require('../db.js');
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

// --- CREATE TICKET ---
const createTicket = async (req, res) => {
  const { title, description, student_id, priority, category } = req.body;

  if (!title || !description || !student_id) {
    return res.status(400).json({ error: "Title, description, and student creator are required" });
  }

  try {
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('location_id')
      .eq('id', student_id)
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    const { data: ticket, error } = await supabase
      .from('tickets')
      .insert([{ 
        title, 
        description, 
        student_id,
        priority: priority || 'Medium', // Defaulting to Medium as per requirement
        category: category || 'Other',
        status: 'Open',
        location_id: student.location_id 
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

// --- GET ALL TICKETS (MODIFIED FOR SEARCH & STUDENT TICKET COUNT) ---
const getAllTickets = async (req, res) => {
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

  try {
    const { status, search, category, page = 1, limit = 15 } = req.query;
    const offset = (page - 1) * limit;

    // We select the student details and use a sub-selection to get the count of all tickets for that student
    let query = supabase
      .from('tickets')
      .select(`
        id, title, description, status, priority, category, created_at, updated_at,
        student:students(
          id, 
          name,
          student_ticket_count:tickets(count)
        ),
        assignee:users(id, username),
        assignee_id
      `, { count: 'exact' })
      .eq('location_id', req.locationId);

    if (status && status !== 'All') {
      query = query.eq('status', status);
    }
    
    if (category && category !== 'All') {
      query = query.eq('category', category);
    }

    if (search) {
      // MODIFIED: Added search for student name via foreign key relation
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,students.name.ilike.%${search}%`);
    }
    
    query = query.order('created_at', { ascending: false });
    query = query.range(offset, offset + limit - 1);

    const { data: tickets, error, count } = await query;

    if (error) return handleSupabaseError(res, error, 'fetching tickets');

    // Flatten the count for easier frontend use: ticket.student.student_ticket_count[0].count -> ticket.student_ticket_count
    const transformedTickets = tickets.map(ticket => ({
      ...ticket,
      student_ticket_count: ticket.student?.student_ticket_count?.[0]?.count || 0
    }));

    res.status(200).json({
      items: transformedTickets,
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

// --- UPDATE TICKET (MODIFIED TO ALLOW PRIORITY SELECTION) ---
const updateTicket = async (req, res) => {
  const { id } = req.params;
  const { assignee_id, status, priority } = req.body; // MODIFIED: Added priority here
  
  const updatePayload = {};

  if (status) {
    // Note: 'In Progress' is usually handled by the chat RPC, but we allow 'Resolved' here
    updatePayload.status = status;
  }
  
  if (priority) {
    // MODIFIED: Admins can now change priority (Low, Medium, High)
    updatePayload.priority = priority;
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
      .select(`*, student:students(name)`)
      .single();

    if (error) return handleSupabaseError(res, error, `updating ticket ${id}`);

    // Log the activity based on what changed
    let activityDetail = `Updated ticket "${ticket.title}".`;
    if (status) activityDetail += ` Status changed to ${status}.`;
    if (priority) activityDetail += ` Priority changed to ${priority}.`;

    await logActivity("Updated", activityDetail, req.user.id);

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

const getAdmins = async (req, res) => {
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

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
        .eq('location_id', req.locationId) 
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
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }
  
  try {
    const { data, error } = await supabase
      .rpc('get_unique_ticket_categories', {
        p_location_id: req.locationId 
      })
      .limit(2000); 
      
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