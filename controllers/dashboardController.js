// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  const { search = '' } = req.query;

  try {
    const { data, error } = await supabase
      .from('v_admission_financial_summary')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = search
      ? data.filter(r =>
          r.student_name?.toLowerCase().includes(search.toLowerCase()) ||
          r.student_phone_number?.includes(search) ||
          r.admission_number?.toLowerCase().includes(search.toLowerCase())
        )
      : data;

    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();

    const metrics = {
      totalAdmissions: rows.length,
      admissionsThisMonth: rows.filter(r => {
        const d = new Date(r.created_at);
        return d.getMonth() === m && d.getFullYear() === y;
      }).length,
      totalCollected: rows.reduce((s, r) => s + Number(r.total_paid || 0), 0),
      revenueCollectedThisMonth: rows
        .filter(r => {
          const d = new Date(r.created_at);
          return d.getMonth() === m && d.getFullYear() === y;
        })
        .reduce((s, r) => s + Number(r.total_paid || 0), 0),
      totalOutstanding: rows.reduce(
        (s, r) => s + Number(r.remaining_due || 0),
        0
      ),
      overdueCount: rows.filter(r => r.status === 'Overdue').length,
    };

    res.status(200).json({
      metrics,
      admissions: rows,
    });

  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};
