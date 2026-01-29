const supabase = require('../db');
const { format } = require('date-fns');

/**
 * @description Get the task list for the main follow-up dashboard.
 * [UPDATED] Filters results by branch using req.locationId from auth middleware.
 */
exports.getFollowUpTasks = async (req, res) => {
  const { dateFilter, searchTerm, batchName, assignedTo, dueAmountMin, startDate, endDate } = req.query;
  const locationId = req.locationId; // Captured from Auth Middleware

  if (!locationId) {
    return res.status(403).json({ error: 'Unauthorized: No branch assigned to this user.' });
  }

  try {
    const today = format(new Date(), 'yyyy-MM-dd');

    // ✅ Helper for common filters including the critical location filter
    const buildBaseFilters = (q) => {
      q = q.eq('location_id', locationId) // Enforcement of branch-specific data
           .gt('total_due_amount', 0);    // Exclude fully paid students
      
      if (searchTerm) {
        q = q.or(`student_name.ilike.%${searchTerm}%,student_phone.ilike.%${searchTerm}%,admission_number.ilike.%${searchTerm}%`);
      }
      if (batchName) q = q.eq('batch_name', batchName);
      if (assignedTo) q = q.eq('assigned_to', assignedTo);
      if (dueAmountMin) q = q.gte('total_due_amount', dueAmountMin);
      return q;
    };

    // ✅ 1. Today's Count Logic
    let todayQ = supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true });
    todayQ = buildBaseFilters(todayQ)
      .eq('next_task_due_date', today)
      .or(`last_log_created_at.is.null,last_log_created_at.lt.${today}`);

    // ✅ 2. Overdue Count Logic
    let overdueQ = supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true });
    overdueQ = buildBaseFilters(overdueQ).lt('next_task_due_date', today);

    // ✅ 3. Upcoming Count Logic
    let upcomingQ = supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true });
    upcomingQ = buildBaseFilters(upcomingQ).gt('next_task_due_date', today);

    const [todayRes, overdueRes, upcomingRes] = await Promise.all([todayQ, overdueQ, upcomingQ]);

    // ✅ 4. Fetch the filtered list data
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
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Create a follow-up log.
 * [UPDATED] Validates branch security before insertion.
 */
exports.createFollowUpLog = async (req, res) => {
  const { admission_id, notes, next_follow_up_date, type, lead_type } = req.body;
  const user_id = req.user?.id;
  const locationId = req.locationId;

  if (!admission_id || !user_id) {
    return res.status(400).json({ error: 'admission_id and user_id are required.' });
  }

  try {
    // Branch Security Check: Ensure the admission belongs to the same branch
    const { data: check, error: checkErr } = await supabase
      .from('admissions')
      .select('location_id')
      .eq('id', admission_id)
      .single();

    if (checkErr || check.location_id !== locationId) {
      return res.status(403).json({ error: 'Forbidden: You can only log follow-ups for your branch.' });
    }

    const { data: followUp, error: insertError } = await supabase
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
      .select('*')
      .single();

    if (insertError) throw insertError;

    const { data: userData } = await supabase.from('users').select('username').eq('id', user_id).single();

    res.status(201).json({ 
      message: "Follow-up log saved.", 
      data: { ...followUp, staff_name: userData?.username || 'System' } 
    });
  } catch (error) {
    console.error('Error creating follow-up log:', error);
    res.status(500).json({ error: 'An error occurred while creating the follow-up log.' });
  }
};

/**
 * @description Fetch history for a specific admission.
 */
exports.getFollowUpHistoryForAdmission = async (req, res) => {
  const { admissionId } = req.params;

  if (!admissionId) {
    return res.status(400).json({ error: 'Admission ID is required.' });
  }

  try {
    const { data: logs, error: logsError } = await supabase
      .from('follow_up_details') 
      .select('*, user_id')
      .eq('admission_id', admissionId)
      .order('log_date', { ascending: false });

    if (logsError) throw logsError;
    if (!logs || logs.length === 0) return res.status(200).json([]);

    const staffIds = [...new Set(logs.map(log => log.user_id || log.staff_id).filter(Boolean))];
    let staffMap = {};

    if (staffIds.length > 0) {
      const { data: staffData } = await supabase
        .from('users')
        .select('id, username')
        .in('id', staffIds);

      staffData?.forEach(user => {
        staffMap[user.id] = user.username;
      });
    }

    const formattedHistory = logs.map(log => ({
      ...log,
      staff_name: staffMap[log.user_id || log.staff_id] || 'System' 
    }));

    res.status(200).json(formattedHistory);
  } catch (error) {
    console.error('Error fetching follow-up history:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};