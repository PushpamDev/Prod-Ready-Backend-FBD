// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  // ✅ 1. Capture the branch ID from the auth middleware or headers
  const userLocationId = req.locationId || req.user?.location_id; 
  const { search = '', status, batch, undertaking } = req.query;

  if (!userLocationId) {
    return res.status(403).json({ error: 'Access denied: No branch location assigned to user.' });
  }

  try {
    // Start query on the summary view
    let query = supabase
      .from('v_admission_financial_summary')
      .select('*')
      // ✅ 2. STRICT BRANCH FILTER: Only show data belonging to this staff's branch
      .eq('location_id', userLocationId); 

    // ✅ APPLY OPTIONAL FILTERS
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (batch && batch !== 'all') {
      // Use ilike for batch to handle potential string matching issues in views
      query = query.ilike('batch_name', `%${batch}%`);
    }

    if (undertaking && undertaking !== 'all') {
      query = query.eq('undertaking_status', undertaking);
    }

    if (search) {
      query = query.or(`student_name.ilike.%${search}%,admission_number.ilike.%${search}%,student_phone_number.ilike.%${search}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // ✅ 3. DATA DE-DUPLICATION LOGIC
    // We create a Map using admission_id as the key. 
    // If a duplicate ID is found, we keep the one with the higher paid amount (fixes the ₹0 bug).
    const uniqueAdmissionsMap = new Map();
    
    data.forEach(record => {
      const existing = uniqueAdmissionsMap.get(record.admission_id);
      if (!existing || (Number(record.total_paid) > Number(existing.total_paid))) {
        uniqueAdmissionsMap.set(record.admission_id, record);
      }
    });

    const admissions = Array.from(uniqueAdmissionsMap.values());

    // ✅ 4. METRICS CALCULATION (Using Cleaned Data)
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const metrics = {
      totalAdmissions: admissions.length,

      admissionsThisMonth: admissions.filter(r => {
        const d = new Date(r.created_at);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }).length,

      totalCollected: admissions.reduce((sum, r) => sum + Number(r.total_paid || 0), 0),

      revenueCollectedThisMonth: admissions
        .filter(r => {
          const d = new Date(r.created_at);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        })
        .reduce((sum, r) => sum + Number(r.total_paid || 0), 0),

      totalOutstanding: admissions.reduce((sum, r) => sum + Number(r.remaining_due || 0), 0),

      overdueCount: admissions.filter(r => r.status === 'Overdue').length,

      pendingUndertakings: admissions.filter(r => r.undertaking_status === 'Pending').length,
    };

    res.status(200).json({
      metrics,
      admissions: admissions, // Sending back clean, unique records
    });

  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};