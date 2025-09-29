const supabase = require('../db');

const sendMessage = async (req, res) => {
  const { ticketId } = req.params;
  // Note: The client will send either sender_user_id or sender_student_id, but not both.
  const { sender_user_id, sender_student_id, message } = req.body;

  if ((!sender_user_id && !sender_student_id) || !message) {
    return res.status(400).json({ error: 'Either sender_user_id or sender_student_id, and a message are required' });
  }

  const payload = {
    ticket_id: ticketId,
    message,
  };

  if (sender_user_id) {
    payload.sender_user_id = sender_user_id;
  } else {
    payload.sender_student_id = sender_student_id;
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('Error sending message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }

    res.status(201).json(data);
  } catch (error) {
    console.error('Internal server error during message sending:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getMessages = async (req, res) => {
  const { ticketId } = req.params;

  try {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        sender_user:users(username),
        sender_student:students(name)
      `)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }

    const messages = data.map(msg => {
        let sender_name = '';
        if (msg.sender_user) {
            sender_name = msg.sender_user.username;
        } else if (msg.sender_student) {
            sender_name = msg.sender_student.name;
        }

        // Clean up the response object
        delete msg.sender_user;
        delete msg.sender_student;

        return {
            ...msg,
            sender_name
        };
    });

    res.status(200).json(messages);
  } catch (error)
{
    console.error('Internal server error while getting messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  sendMessage,
  getMessages,
};