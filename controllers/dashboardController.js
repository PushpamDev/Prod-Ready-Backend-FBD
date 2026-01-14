// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  const { search = '' } = req.query;

  try {
    const { data, error } = await supabase
      .from('v_admission_financial_summary')
      .select(`
        admission_id,
        student_id,
        admission_number,
        student_name,
        student_phone_number,

        certificate_name,
        courses_str,
        batch_name,
        branch,

        total_fees,
        total_paid,
        remaining_due,
        balance_due,
        status,

        undertaking_status,
        undertaking_completed,
        undertaking_completed_at,

        approval_status,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    /* ------------------------------------
       SEARCH FILTER (SAFE, FRONTEND-ONLY)
    ------------------------------------- */
    const rows = search
      ? data.filter(r =>
          r.student_name?.toLowerCase().includes(search.toLowerCase()) ||
          r.student_phone_number?.includes(search) ||
          r.admission_number?.toLowerCase().includes(search.toLowerCase())
        )
      : data;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    /* ------------------------------------
       DASHBOARD METRICS (READ-ONLY)
       NO BUSINESS LOGIC HERE
    ------------------------------------- */
    const metrics = {
      totalAdmissions: rows.length,

      admissionsThisMonth: rows.filter(r => {
        const d = new Date(r.created_at);
        return (
          d.getMonth() === currentMonth &&
          d.getFullYear() === currentYear
        );
      }).length,

      totalCollected: rows.reduce(
        (sum, r) => sum + Number(r.total_paid || 0),
        0
      ),

      revenueCollectedThisMonth: rows
        .filter(r => {
          const d = new Date(r.created_at);
          return (
            d.getMonth() === currentMonth &&
            d.getFullYear() === currentYear
          );
        })
        .reduce(
          (sum, r) => sum + Number(r.total_paid || 0),
          0
        ),

      totalOutstanding: rows.reduce(
        (sum, r) => sum + Number(r.remaining_due || 0),
        0
      ),

      overdueCount: rows.filter(r => r.status === 'Overdue').length,

      pendingUndertakings: rows.filter(
        r => r.undertaking_status === 'Pending'
      ).length,
    };

    /* ------------------------------------
       RESPONSE
    ------------------------------------- */
    res.status(200).json({
      metrics,
      admissions: rows,
    });

  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({
      error: 'Failed to load dashboard',
    });
  }
};
