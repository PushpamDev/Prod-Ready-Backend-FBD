const supabase = require('../db');
const { format } = require('date-fns');

/**
 * @description Get the task list for the main follow-up dashboard.
 * [UPDATED] Filters 'Today', searches by Admission Number, and automatically fetches new columns.
 */
exports.getFollowUpTasks = async (req, res) => {
  const { dateFilter, searchTerm, batchName, assignedTo, dueAmountMin, startDate, endDate } = req.query;

  try {
    const today = format(new Date(), 'yyyy-MM-dd');

    // ✅ Helper for common filters (excluding date-specific logic)
    const buildBaseFilters = (q) => {
      q = q.gt('total_due_amount', 0); // Exclude paid students
      if (searchTerm) {
        q = q.or(`student_name.ilike.%${searchTerm}%,student_phone.ilike.%${searchTerm}%,admission_number.ilike.%${searchTerm}%`);
      }
      if (batchName) q = q.eq('batch_name', batchName);
      if (assignedTo) q = q.eq('assigned_to', assignedTo);
      if (dueAmountMin) q = q.gte('total_due_amount', dueAmountMin);
      return q;
    };

    // ✅ 1. Today's Count Logic: Due today AND not processed yet today
    let todayQ = supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true });
    todayQ = buildBaseFilters(todayQ)
      .eq('next_task_due_date', today)
      .or(`last_log_created_at.is.null,last_log_created_at.lt.${today}`);

    // ✅ 2. Overdue Count Logic: Due before today
    let overdueQ = supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true });
    overdueQ = buildBaseFilters(overdueQ).lt('next_task_due_date', today);

    // ✅ 3. Upcoming Count Logic: Due after today
    let upcomingQ = supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true });
    upcomingQ = buildBaseFilters(upcomingQ).gt('next_task_due_date', today);

    const [todayRes, overdueRes, upcomingRes] = await Promise.all([todayQ, overdueQ, upcomingQ]);

    // ✅ 4. Fetch the actual list data
    let dataQuery = supabase.from('v_follow_up_task_list').select('*');
    dataQuery = buildBaseFilters(dataQuery);

    if (dateFilter === 'today') {
      dataQuery = dataQuery.eq('next_task_due_date', today)
                           .or(`last_log_created_at.is.null,last_log_created_at.lt.${today}`);
    } else if (dateFilter === 'overdue') {
      dataQuery = dataQuery.lt('next_task_due_date', today);
    } else if (dateFilter === 'upcoming') {
      dataQuery = dataQuery.gt('next_task_due_date', today);
    }

    // Handle Custom Date Range
    if (startDate) dataQuery = dataQuery.gte('next_task_due_date', startDate);
    if (endDate) dataQuery = dataQuery.lte('next_task_due_date', endDate);

    const { data, error } = await dataQuery.order('next_task_due_date', { ascending: true });

    if (error) throw error;

    res.status(200).json({
      tasks: data || [],
      counts: {
        today: todayRes.count || 0,
        overdue: overdueRes.count || 0,
        upcoming: upcomingRes.count || 0
      }
    });
  } catch (error) {
    console.error('Error:', error);
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