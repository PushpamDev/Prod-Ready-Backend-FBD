// controllers/followUpController.js
const supabase = require('../db');
const { format } = require('date-fns');

/**
 * @description Get the task list for the main follow-up dashboard.
 * Queries the GROUPED 'v_follow_up_task_list' view.
 */
exports.getFollowUpTasks = async (req, res) => {
  const { filter } = req.query; // today | overdue | upcoming

  try {
    let query = supabase
      .from('v_follow_up_task_list')
      .select('*');

    const today = format(new Date(), 'yyyy-MM-dd');

    // Filter by the most urgent task date for that student
    if (filter === 'today') {
      query = query.eq('next_task_due_date', today);
    } else if (filter === 'overdue') {
      query = query.lt('next_task_due_date', today);
    } else if (filter === 'upcoming') {
      query = query.gt('next_task_due_date', today);
    }
    // 'all' (default) applies no date filter

    // Order by the most urgent date
    const { data, error } = await query.order('next_task_due_date', { ascending: true });

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching follow-up tasks:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Create a new CRM follow-up communication log and schedule the next task.
 * Does NOT record financial payments.
 */
exports.createFollowUpLog = async (req, res) => {
  const {
    admission_id,
    notes,
    next_follow_up_date, // Date for the *next* task
    type,                // 'Call', 'SMS', etc.
    lead_type            // 'Hot', 'Warm', 'Cold'
  } = req.body;

  const user_id = req.user?.id; // Assumes auth middleware sets req.user

  // Validation
  if (!admission_id || !user_id) {
    return res.status(400).json({ error: 'admission_id and user_id are required.' });
  }
  if (!next_follow_up_date) {
    return res.status(400).json({ error: 'A "Next Follow-up Date" is required to schedule the next task.' });
  }
   if (isNaN(Date.parse(next_follow_up_date))) {
        return res.status(400).json({ error: 'Invalid next_follow_up_date.' });
    }

  try {
    const { data, error } = await supabase
      .from('follow_ups')
      .insert({
        admission_id,
        user_id,
        notes: notes || '',
        follow_up_date: new Date().toISOString(), // Log created *now*
        next_follow_up_date: next_follow_up_date, // Next task due on this date
        type: type || 'Call', // Default type
        lead_type: lead_type || null
      })
      .select('id') // Return the ID of the created log
      .single();

    if (error) throw error;

    res.status(201).json({ message: "Follow-up log saved. Next task has been scheduled.", data });
  } catch (error) {
    console.error('Error creating follow-up log:', error);
    if (error.code === '23503') { // Foreign key violation
      return res.status(404).json({ error: 'The specified admission or user does not exist.' });
    }
    res.status(500).json({ error: 'An error occurred while creating the follow-up log.' });
  }
};

// ** REMOVED exports.getAdmissionFollowUpDetails **
// The frontend component StudentFollowUpDetail should now call
// GET /api/accounts/admissions/:admissionId handled by accountsController.getAccountDetails