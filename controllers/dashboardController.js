// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  // ✅ Capture all filter parameters from the frontend
  const { search = '', status, batch, undertaking } = req.query;

  try {
    let query = supabase
      .from('v_admission_financial_summary')
      .select('*');

    // ✅ APPLY FILTERS DIRECTLY IN THE DATABASE QUERY
    
    // 1. Fee Status Filter (Paid, Overdue, Pending)
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // 2. Batch Name Filter
    if (batch && batch !== 'all') {
      query = query.eq('batch_name', batch);
    }

    // 3. Undertaking Status Filter
    if (undertaking && undertaking !== 'all') {
      query = query.eq('undertaking_status', undertaking);
    }

    // 4. Search Filter (Student Name, Admission No, or Phone)
    if (search) {
      query = query.or(`student_name.ilike.%${search}%,admission_number.ilike.%${search}%,student_phone_number.ilike.%${search}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // ✅ Calculate Metrics based on the FILTERED data
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