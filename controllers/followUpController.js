const supabase = require('../db');
const { format } = require('date-fns');

/**
 * @description Get the task list for the main follow-up dashboard.
 * [UPDATED] Added 'pushpam' override for global view.
 */
exports.getFollowUpTasks = async (req, res) => {
  const { dateFilter, searchTerm, batchName, assignedTo, dueAmountMin, startDate, endDate } = req.query;
  const locationId = req.locationId;
  const isPushpam = req.user?.username === 'pushpam';

  try {
    const today = format(new Date(), 'yyyy-MM-dd');

    const buildBaseFilters = (q) => {
      // ✅ Security: Only filter by location if NOT pushpam
      if (!isPushpam) {
        if (!locationId) throw new Error('LOCATION_REQUIRED');
        q = q.eq('location_id', locationId);
      }
      
      q = q.gt('total_due_amount', 0);
      
      if (searchTerm) {
        q = q.or(`student_name.ilike.%${searchTerm}%,student_phone.ilike.%${searchTerm}%,admission_number.ilike.%${searchTerm}%`);
      }
      if (batchName) q = q.eq('batch_name', batchName);
      if (assignedTo) q = q.eq('assigned_to', assignedTo);
      if (dueAmountMin) q = q.gte('total_due_amount', dueAmountMin);
      return q;
    };

    // 1-3. Fetch Counts
    const [todayRes, overdueRes, upcomingRes] = await Promise.all([
      buildBaseFilters(supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true }))
        .eq('next_task_due_date', today)
        .or(`last_log_created_at.is.null,last_log_created_at.lt.${today}`),
      buildBaseFilters(supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true }))
        .lt('next_task_due_date', today),
      buildBaseFilters(supabase.from('v_follow_up_task_list').select('*', { count: 'exact', head: true }))
        .gt('next_task_due_date', today)
    ]);

    // 4. Fetch actual list
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
    if (error.message === 'LOCATION_REQUIRED') {
      return res.status(403).json({ error: 'Unauthorized: No branch assigned.' });
    }
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Create a follow-up log.
 * [FIXED] Handles UUID types and prevents 'Admission not found' errors.
 */
exports.createFollowUpLog = async (req, res) => {
  const { admission_id, notes, next_follow_up_date, type, lead_type } = req.body;
  const user_id = req.user?.id;
  const username = req.user?.username;
  const locationId = req.locationId;

  if (!admission_id || !user_id) {
    return res.status(400).json({ error: 'admission_id and user_id are required.' });
  }

  try {
    // 1. Fetch the admission to check branch security
    const { data: admission, error: fetchErr } = await supabase
      .from('admissions')
      .select('location_id')
      .eq('id', admission_id) // Ensure frontend sends a valid UUID
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!admission) {
      return res.status(404).json({ error: `Admission record [${admission_id}] not found in database.` });
    }

    // 2. Security Gate
    const isPushpam = username === 'pushpam';
    const isSameBranch = admission.location_id && locationId && (Number(admission.location_id) === Number(locationId));

    if (!isPushpam && !isSameBranch) {
      return res.status(403).json({ 
        error: `Access Denied. Branch mismatch (Student: ${admission.location_id}, User: ${locationId})` 
      });
    }

    // 3. Insert Follow-up
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

    // 4. Return with staff name
    const { data: userData } = await supabase.from('users').select('username').eq('id', user_id).single();

    res.status(201).json({ 
      message: "Follow-up log saved.", 
      data: { ...followUp, staff_name: userData?.username || 'System' } 
    });
  } catch (error) {
    console.error('Error creating follow-up log:', error);
    res.status(500).json({ error: error.message || 'Internal server error.' });
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

    const staffIds = [...new Set((logs || []).map(log => log.user_id).filter(Boolean))];
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

    const formattedHistory = (logs || []).map(log => ({
      ...log,
      staff_name: staffMap[log.user_id] || 'System' 
    }));

    res.status(200).json(formattedHistory);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};