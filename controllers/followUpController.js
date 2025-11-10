// controllers/followUpController.js
const supabase = require('../db');
const { format } = require('date-fns');

/**
 * @description Get the task list for the main follow-up dashboard.
 * [UPDATED] Now correctly filters the 'Today' tab.
 */
exports.getFollowUpTasks = async (req, res) => {
  const { 
    dateFilter, // 'today', 'overdue', 'upcoming'
    searchTerm,
    batchName,
    assignedTo,
    dueAmountMin,
    startDate,
    endDate 
  } = req.query;

  try {
    let query = supabase
      .from('v_follow_up_task_list')
      .select('*');

    const today = format(new Date(), 'yyyy-MM-dd');

    // --- THIS IS THE FIX ---

    // A. Date Filter Tabs
    if (dateFilter === 'today') {
      query = query.eq('next_task_due_date', today);
      
      // AND (the last log was created before today OR there is no log at all)
      // This prevents students who were already contacted today from appearing.
      query = query.or(`last_log_created_at.is.null,last_log_created_at.lt.${today}`);
      
    } else if (dateFilter === 'overdue') {
      query = query.lt('next_task_due_date', today);
    } else if (dateFilter === 'upcoming') {
      query = query.gt('next_task_due_date', today);
    }

    // --- END OF FIX ---

    // B. Search Term
    if (searchTerm) {
      query = query.or(`student_name.ilike.%${searchTerm}%,student_phone.ilike.%${searchTerm}%`);
    }

    // C. Advanced Filters
    if (batchName) {
      query = query.eq('batch_name', batchName);
    }
    if (assignedTo) {
      query = query.eq('assigned_to', assignedTo);
    }
    if (dueAmountMin) {
      query = query.gte('total_due_amount', dueAmountMin);
    }
    
    // D. Custom Date Range (if dateFilter is not set to a tab)
    if (startDate) {
      query = query.gte('next_task_due_date', startDate);
    }
    if (endDate) {
      query = query.lte('next_task_due_date', endDate);
    }

    // 3. Execute the query
    const { data, error } = await query.order('next_task_due_date', { ascending: true });

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching follow-up tasks:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};


// ... (rest of your file: createFollowUpLog, getFollowUpHistoryForAdmission) ...
// (Make sure to paste your other functions here)

exports.createFollowUpLog = async (req, res) => {
  const {
    admission_id,
    notes,
    next_follow_up_date, // Date for the *next* task
    type,                // 'Call', 'SMS', etc.
    lead_type            // 'Hot', 'Warm', 'Cold'
  } = req.body;

  const user_id = req.user?.id; // Assumes auth middleware sets req.user

  if (!admission_id || !user_id) {
    return res.status(400).json({ error: 'admission_id and user_id are required.' });
  }
  // Note: We allow next_follow_up_date to be null
  // This signifies the task is "completed" without scheduling a new one.

  try {
    const { data, error } = await supabase
      .from('follow_ups')
      .insert({
        admission_id,
        user_id,
        notes: notes || '',
        follow_up_date: new Date().toISOString(), // This is the log date (NOW)
        next_follow_up_date: next_follow_up_date || null, // Next task due date
        type: type || 'Call',
        lead_type: lead_type || null
      })
      .select('id')
      .single();

    if (error) throw error;

    res.status(201).json({ message: "Follow-up log saved.", data });
  } catch (error) {
    console.error('Error creating follow-up log:', error);
    if (error.code === '23503') {
      return res.status(404).json({ error: 'The specified admission or user does not exist.' });
    }
    res.status(500).json({ error: 'An error occurred while creating the follow-up log.' });
  }
};

exports.getFollowUpHistoryForAdmission = async (req, res) => {
  const { admissionId } = req.params;

  if (!admissionId) {
    return res.status(400).json({ error: 'Admission ID is required.' });
  }

  try {
    const { data, error } = await supabase
      .from('follow_up_details') // Using our view
      .select('*')
      .eq('admission_id', admissionId)
      .order('log_date', { ascending: false }); // Show newest logs first

    if (error) throw error;

    if (!data) {
      // Return empty array instead of 404, it's not an error
      return res.status(200).json([]);
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching follow-up history:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};