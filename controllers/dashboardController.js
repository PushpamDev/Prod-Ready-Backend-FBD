// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  // ✅ 1. Capture the branch ID from the auth middleware or headers
  // Usually, your auth middleware should attach this to req.user or req.locationId
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
      query = query.eq('batch_name', batch);
    }

    if (undertaking && undertaking !== 'all') {
      query = query.eq('undertaking_status', undertaking);
    }

    if (search) {
      query = query.or(`student_name.ilike.%${search}%,admission_number.ilike.%${search}%,student_phone_number.ilike.%${search}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // ✅ Metrics are now calculated ONLY from the filtered branch data
    const metrics = {
      totalAdmissions: data.length,

      admissionsThisMonth: data.filter(r => {
        const d = new Date(r.created_at);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }).length,

      totalCollected: data.reduce((sum, r) => sum + Number(r.total_paid || 0), 0),

      revenueCollectedThisMonth: data
        .filter(r => {
          const d = new Date(r.created_at);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        })
        .reduce((sum, r) => sum + Number(r.total_paid || 0), 0),

      totalOutstanding: data.reduce((sum, r) => sum + Number(r.remaining_due || 0), 0),

      overdueCount: data.filter(r => r.status === 'Overdue').length,

      pendingUndertakings: data.filter(r => r.undertaking_status === 'Pending').length,
    };

    res.status(200).json({
      metrics,
      admissions: data,
    });

  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};