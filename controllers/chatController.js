const supabase = require('../db');
const { logActivity } = require("./logActivity");

const handleSupabaseError = (res, error, context) => {
  console.error(`Error ${context}:`, error);
  return res.status(500).json({ error: `Failed to ${context.toLowerCase()}` });
};

// --- This function is reverted to your original code ---
const sendMessage = async (req, res) => {
  const { ticketId } = req.params;
  const { sender_user_id, sender_student_id, message } = req.body;

  if ((!sender_user_id && !sender_student_id) || !message) {
    return res.status(400).json({ error: 'A sender ID (user or student) and a message are required' });
  }

  try {
    if (sender_user_id) {
      // --- ADMIN PATH ---
      const { data: newMessage, error } = await supabase.rpc('send_admin_reply_and_update_status', {
        p_ticket_id: ticketId,
        p_sender_user_id: sender_user_id,
        p_message: message
      });

      if (error) return handleSupabaseError(res, error, 'posting admin message');

      await logActivity("Replied", `Admin replied to ticket ID ${ticketId}`, sender_user_id);
      return res.status(201).json(newMessage);

    } else {
      // --- STUDENT PATH ---
      const payload = {
        ticket_id: ticketId,
        message,
        sender_student_id: sender_student_id,
      };

      const { data, error } = await supabase
        .from('messages')
        .insert([payload])
        .select()
        .single();
      
      if (error) return handleSupabaseError(res, error, 'posting student message');
      
      return res.status(201).json(data);
    }

  } catch (error) {
    console.error('Internal server error during message sending:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- This function is updated with PAGINATION ---
const getMessages = async (req, res) => {
  const { ticketId } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  // You can also get pageSize from query params for more flexibility
  const pageSize = parseInt(req.query.pageSize, 10) || 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    const { data, error, count } = await supabase
      .from('messages')
      .select(`
        *,
        sender_user:users(username),
        sender_student:students(name)
      `, { count: 'exact' }) // Get the total count for pagination
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .range(from, to); // Fetch only one page of results

    if (error) {
      return handleSupabaseError(res, error, 'fetching messages');
    }

    const messages = data.map(msg => {
        let sender_name = 'Unknown';
        if (msg.sender_user) {
            sender_name = msg.sender_user.username;
        } else if (msg.sender_student) {
            sender_name = msg.sender_student.name;
        }
        delete msg.sender_user;
        delete msg.sender_student;
        return { ...msg, sender_name };
    });

    // Return the paginated response
    res.status(200).json({
      messages,
      totalPages: Math.ceil(count / pageSize),
      currentPage: page,
      totalMessages: count,
    });
  } catch (error) {
    console.error('Internal server error while getting messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  sendMessage,
  getMessages,
};