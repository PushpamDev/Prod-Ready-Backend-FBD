const supabase = require('../db.js');
const { get } = require('../routes/substitution.js');
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
  return res.status(500).json({ error: `Failed to ${context.toLowerCase()}: ${error.message}` });
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
        priority: priority || 'Medium',
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
    res.status(500).json({ error: "Internal server error" });
  }
};

// --- GET ALL TICKETS (REVISED FOR SUPER ADMIN CITY FILTERING) ---
const getAllTickets = async (req, res) => {
  const isSuperAdmin = req.isSuperAdmin; 

  // Super Admin bypasses mandatory location check; all others must have req.locationId
  if (!isSuperAdmin && !req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

  try {
    // ✅ Destructure location_id from query for Super Admin filtering
    const { status, search, category, page = 1, limit = 15, from, to, location_id } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;
    const userRole = req.user.role; 

    // 1. Initialize Base Queries
    let countQuery = supabase.from('tickets').select('status, assignee_id, student_id, created_at, location_id');
    let mainQuery = supabase
      .from('tickets')
      .select(`
        id, title, description, status, priority, category, created_at, updated_at,
        student:students(id, name, student_ticket_count:tickets(count)),
        assignee:users(id, username),
        assignee_id,
        student_id,
        location_id
      `, { count: 'exact' });

    // 2. ✅ APPLY LOCATION LOGIC
    if (isSuperAdmin) {
      // If Super Admin provided a specific city filter, use it. Otherwise, show all cities.
      if (location_id && location_id !== 'All') {
        countQuery = countQuery.eq('location_id', location_id);
        mainQuery = mainQuery.eq('location_id', location_id);
      }
    } else {
      // Standard Admins are strictly locked to their branch
      countQuery = countQuery.eq('location_id', req.locationId);
      mainQuery = mainQuery.eq('location_id', req.locationId);
    }

    // 3. Apply Role-Based Filtering
    if (userRole === 'student') {
      countQuery = countQuery.eq('student_id', userId);
      mainQuery = mainQuery.eq('student_id', userId);
    } 

    // 4. Apply Date Range Filters (From/To)
    if (from) {
      countQuery = countQuery.gte('created_at', from);
      mainQuery = mainQuery.gte('created_at', from);
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      countQuery = countQuery.lte('created_at', toDate.toISOString());
      mainQuery = mainQuery.lte('created_at', toDate.toISOString());
    }

    // 5. Fetch Aggregate Counts for UI Dropdowns
    const { data: countData, error: countError } = await countQuery;
    if (countError) throw countError;

    const counts = {
      All: countData?.length || 0,
      Open: countData?.filter(t => t.status === 'Open').length || 0,
      'In Progress': countData?.filter(t => t.status === 'In Progress').length || 0,
      Resolved: countData?.filter(t => t.status === 'Resolved').length || 0,
    };

    // 6. Apply Search and Category Filters
    if (status && status !== 'All') mainQuery = mainQuery.eq('status', status);
    if (category && category !== 'All') mainQuery = mainQuery.eq('category', category);
    if (search) {
      mainQuery = mainQuery.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // 7. Execute Main Paginated Query
    const { data: tickets, error, count } = await mainQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return handleSupabaseError(res, error, 'fetching tickets');

    const transformedTickets = tickets.map(ticket => ({
      ...ticket,
      student_ticket_count: ticket.student?.student_ticket_count?.[0]?.count || 0
    }));

    res.status(200).json({
      items: transformedTickets,
      total: count,
      counts,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

  } catch (error) {
     console.error("Internal server error while getting tickets:", error);
     res.status(500).json({ error: "Internal server error" });
  }
};

// --- GET TICKET BY ID ---
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
     res.status(500).json({ error: "Internal server error" });
  }
};

// --- UPDATE TICKET ---
// --- UPDATE TICKET (SUPER ADMIN ONLY RE-ASSIGNMENT) ---
const updateTicket = async (req, res) => {
  const { id } = req.params;
  const { assignee_id, status, priority } = req.body;
  const isSuperAdmin = req.isSuperAdmin;
  
  try {
    const { data: currentTicket, error: fetchErr } = await supabase
        .from('tickets')
        .select('assignee_id, title')
        .eq('id', id)
        .single();

    if (fetchErr) return handleSupabaseError(res, fetchErr, 'finding ticket');

    const updatePayload = { updated_at: new Date().toISOString() };
    if (status) updatePayload.status = status;
    if (priority) updatePayload.priority = priority;

    // ✅ RE-ASSIGNMENT LOGIC
    if (assignee_id !== undefined) {
        // If it's already assigned to someone else, only Super Admin can change it
        if (currentTicket.assignee_id && currentTicket.assignee_id !== assignee_id && !isSuperAdmin) {
            return res.status(403).json({ error: "Only Super Admins can re-assign a ticket that is already in progress." });
        }
        updatePayload.assignee_id = assignee_id;
    }
    
    const { data: ticket, error } = await supabase
      .from('tickets')
      .update(updatePayload)
      .eq('id', id)
      .select(`*, student:students(name)`)
      .single();

    if (error) return handleSupabaseError(res, error, `updating ticket ${id}`);

    await logActivity("Updated", `Ticket "${ticket.title}" updated by ${req.user.id}`, req.user.id);
    res.status(200).json(ticket);

  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// --- REOPEN TICKET ---
const reopenTicket = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('tickets')
      .update({ 
        status: 'Open', 
        updated_at: new Date() 
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return handleSupabaseError(res, error, 'reopening ticket');

    await logActivity("Reopened", `Ticket "${data.title}" was reopened.`, req.user.id);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// --- DELETE TICKET ---
const deleteTicket = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: ticket, error } = await supabase.from('tickets').delete().eq('id', id).select().single();
    if (error) return handleSupabaseError(res, error, `deleting ticket ${id}`);
    await logActivity("Deleted", `Ticket "${ticket.title}" deleted.`, req.user.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// --- GET ADMINS (FOR ASSIGNMENT) ---
const getAdmins = async (req, res) => {
  const isSuperAdmin = req.isSuperAdmin;
  // If Super Admin selects a city, use that. Otherwise, use their session location.
  const targetLocationId = (isSuperAdmin && req.query.location_id && req.query.location_id !== 'All') 
    ? req.query.location_id 
    : req.locationId;

  if (!targetLocationId && !isSuperAdmin) {
    return res.status(401).json({ error: 'Location required.' });
  }

  try {
    let query = supabase
      .from('users')
      .select('id, username')
      .eq('role', 'admin');

    // Apply location filter if we have a specific city context
    if (targetLocationId && targetLocationId !== 'All') {
      query = query.eq('location_id', targetLocationId);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// --- GET CATEGORIES ---
const getTicketCategories = async (req, res) => {
  if (!req.locationId) return res.status(401).json({ error: 'Location required.' });
  try {
    const { data, error } = await supabase.rpc('get_unique_ticket_categories', { p_location_id: req.locationId });
    if (error) throw error;
    res.status(200).json(data.map(item => item.category));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// --- POST CHAT MESSAGE (WITH AUTO-ASSIGNMENT LOGIC) ---
const postChatMessage = async (req, res) => {
    const { ticketId } = req.params;
    const { message } = req.body;
    const senderId = req.user.id; 
    const userRole = req.user.role; 

    if (!message) return res.status(400).json({ error: 'Message cannot be empty.' });

    try {
        // 1. Fetch current ticket status and existing assignee
        const { data: ticket, error: ticketErr } = await supabase
            .from('tickets')
            .select('status, assignee_id, title')
            .eq('id', ticketId)
            .single();

        if (ticketErr) throw ticketErr;
        if (ticket.status === 'Resolved') {
            return res.status(403).json({ error: 'Cannot reply to a resolved ticket. Please reopen it first.' });
        }

        // 2. Prepare Chat Payload
        const chatPayload = {
            ticket_id: ticketId,
            message: message
        };

        const isAdminSender = userRole === 'admin' || userRole === 'super_admin';

        if (isAdminSender) {
            chatPayload.sender_user_id = senderId;
        } else {
            chatPayload.sender_student_id = senderId;
        }

        // 3. ✅ AUTO-ASSIGNMENT LOGIC (THE "BETTER SOLUTION")
        // If an admin/super_admin is replying and the ticket is currently unassigned
        if (isAdminSender && !ticket.assignee_id) {
            const { error: assignError } = await supabase
                .from('tickets')
                .update({ 
                    assignee_id: senderId, 
                    status: 'In Progress',
                    updated_at: new Date().toISOString() 
                })
                .eq('id', ticketId);

            if (assignError) console.error("Auto-assignment failed:", assignError);
            else {
                await logActivity("Auto-Assigned", `Ticket "${ticket.title}" auto-assigned to first responder ${senderId}`, senderId);
            }
        }

        // 4. Insert the message
        const { data: newMessage, error: insertErr } = await supabase
            .from('ticket_chats')
            .insert([chatPayload])
            .select(`
                id, message, created_at, sender_user_id, sender_student_id,
                user:users(id, username),
                student:students(id, name)
            `)
            .single();

        if (insertErr) throw insertErr;

        await logActivity("Replied", `Message sent to ticket ID ${ticketId}`, senderId);
        res.status(201).json(newMessage);

    } catch (error) {
        console.error("Error in postChatMessage:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getChatMessages = async (req, res) => {
  const { ticketId } = req.params;

  try {
    const { data: messages, error } = await supabase
      .from('ticket_chats')
      .select(`
        id,
        message,
        created_at,
        sender_user_id,
        sender_student_id,
        user:users(id, username),
        student:students(id, name)
      `)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) return handleSupabaseError(res, error, 'fetching chat messages');

    res.status(200).json(messages);
  } catch (error) {
    console.error(`Internal server error while fetching messages for ticket ${ticketId}:`, error);
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
  getChatMessages,
  reopenTicket,
};