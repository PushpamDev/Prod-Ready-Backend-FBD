// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  // ✅ 1. Capture the branch ID and filter parameters
  const userLocationId = req.locationId || req.user?.location_id; 
  const { 
    search = '', 
    status, 
    batch, 
    undertaking, 
    startDate, // ISO string YYYY-MM-DD
    endDate    // ISO string YYYY-MM-DD
  } = req.query;

  if (!userLocationId) {
    return res.status(403).json({ error: 'Access denied: No branch location assigned to user.' });
  }

  try {
    // Start query on the summary view
    let query = supabase
      .from('v_admission_financial_summary')
      .select('*')
      .eq('location_id', userLocationId); 

    // ✅ APPLY DATE FILTERS
    // Using date_of_admission or created_at depending on your view's column naming
    if (startDate) {
      query = query.gte('date_of_admission', startDate);
    }
    if (endDate) {
      query = query.lte('date_of_admission', endDate);
    }

    // ✅ APPLY OPTIONAL FILTERS
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (batch && batch !== 'all') {
      query = query.ilike('batch_name', `%${batch}%`);
    }

    if (undertaking && undertaking !== 'all') {
      query = query.eq('undertaking_status', undertaking);
    }

    if (search) {
      query = query.or(`student_name.ilike.%${search}%,admission_number.ilike.%${search}%,student_phone_number.ilike.%${search}%`);
    }

    const { data, error } = await query.order('date_of_admission', { ascending: false });

    if (error) throw error;

    // ✅ 2. DATA DE-DUPLICATION LOGIC
    const uniqueAdmissionsMap = new Map();
    
    data.forEach(record => {
      const existing = uniqueAdmissionsMap.get(record.admission_id);
      // Keep the record with the most complete financial data if duplicates exist in the view
      if (!existing || (Number(record.total_paid) > Number(existing.total_paid))) {
        uniqueAdmissionsMap.set(record.admission_id, record);
      }
    });

    const admissions = Array.from(uniqueAdmissionsMap.values());

    // ✅ 3. METRICS CALCULATION (Dynamic based on selected range)
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const metrics = {
      // Total records found within this specific date filter
      totalAdmissions: admissions.length,

      // Records within the current calendar month (for quick comparison)
      admissionsThisMonth: admissions.filter(r => {
        const d = new Date(r.date_of_admission);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }).length,

      // Total collected from the filtered student list
      totalCollected: admissions.reduce((sum, r) => sum + Number(r.total_paid || 0), 0),

      // Revenue collected specifically from students admitted in the selected range
      revenueCollectedThisMonth: admissions.reduce((sum, r) => sum + Number(r.total_paid || 0), 0),

      // Current outstanding for the filtered list
      totalOutstanding: admissions.reduce((sum, r) => sum + Number(r.remaining_due || 0), 0),

      overdueCount: admissions.filter(r => r.status === 'Overdue').length,

      pendingUndertakings: admissions.filter(r => r.undertaking_status === 'Pending').length,
    };

    res.status(200).json({
      metrics,
      admissions: admissions,
    });

  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};