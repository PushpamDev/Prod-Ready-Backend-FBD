const supabase = require('../db');
const { format } = require('date-fns');

/**
 * @description Get the task list for the main follow-up dashboard.
 * [UPDATED] Filters 'Today', searches by Admission Number, and automatically fetches new columns.
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
    // 1. Select * from the view. 
    // Since we updated the SQL view, this '*' now includes 'admission_number' and 'last_log_created_at'
    let query = supabase
      .from('v_follow_up_task_list')
      .select('*');

    const today = format(new Date(), 'yyyy-MM-dd');

    // 2. Date Filter Tabs
    if (dateFilter === 'today') {
      // Logic A: The task is officially scheduled for today
      query = query.eq('next_task_due_date', today);
      
      // Logic B: HIDE the task if a log was already created "Today".
      // We check if 'last_log_created_at' is NULL (never called) OR was created BEFORE today (yesterday or older).
      query = query.or(`last_log_created_at.is.null,last_log_created_at.lt.${today}`);
      
    } else if (dateFilter === 'overdue') {
      query = query.lt('next_task_due_date', today);
    } else if (dateFilter === 'upcoming') {
      query = query.gt('next_task_due_date', today);
    }

    // 3. Search Term (Includes Admission Number Search)
    if (searchTerm) {
      // This works because we added admission_number to the view
      query = query.or(`student_name.ilike.%${searchTerm}%,student_phone.ilike.%${searchTerm}%,admission_number.ilike.%${searchTerm}%`);
    }

    // 4. Advanced Filters
    if (batchName) {
      query = query.eq('batch_name', batchName);
    }
    if (assignedTo) {
      query = query.eq('assigned_to', assignedTo);
    }
    if (dueAmountMin) {
      query = query.gte('total_due_amount', dueAmountMin);
    }
    
    // 5. Custom Date Range
    if (startDate) {
      query = query.gte('next_task_due_date', startDate);
    }
    if (endDate) {
      query = query.lte('next_task_due_date', endDate);
    }

    // 6. Execute
    const { data, error } = await query.order('next_task_due_date', { ascending: true });

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching follow-up tasks:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};


exports.createFollowUpLog = async (req, res) => {
  const {
    admission_id,
    notes,
    next_follow_up_date, // Date for the *next* task
    type,                // 'Call', 'SMS', etc.
    lead_type            // 'Hot', 'Warm', 'Cold'
  } = req.body;

  const user_id = req.user?.id; 

  if (!admission_id || !user_id) {
    return res.status(400).json({ error: 'admission_id and user_id are required.' });
  }

  try {
    const { data, error } = await supabase
      .from('follow_ups')
      .insert({
        admission_id,
        user_id,
        notes: notes || '',
        follow_up_date: new Date().toISOString(), 
        next_follow_up_date: next_follow_up_date || null,
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
      .from('follow_up_details') 
      .select('*') // Includes 'admission_number' from the updated view
      .eq('admission_id', admissionId)
      .order('log_date', { ascending: false });

    if (error) throw error;

    if (!data) {
      return res.status(200).json([]);
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching follow-up history:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};