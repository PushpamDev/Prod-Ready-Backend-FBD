// controllers/dashboardController.js
const supabase = require('../db');

/**
 * @description Get all data for the main admissions dashboard.
 * Fetches high-level metrics and a list of all admissions from the financial summary view.
 */
exports.getDashboardData = async (req, res) => {
  const { search = '' } = req.query;

  try {
    // --- 1. Fetch Admissions List ---
    // We use 'v_admission_financial_summary' because it has all the
    // financial data (base, total, paid, remaining, status) we need.
    let query = supabase
      .from('v_admission_financial_summary')
      .select(`
        admission_id,
        student_name,
        student_phone_number,
        created_at,
        status,
        total_payable_amount,
        total_paid,
        remaining_due,
        branch  
      `)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(
        `student_name.ilike.%${search}%,student_phone_number.ilike.%${search}%`
      );
    }

    const { data: admissions, error: admissionsError } = await query;
    if (admissionsError) throw admissionsError;

    // --- 2. Fetch Metrics (This is an example, your logic might be more complex) ---
    // In a real-world scenario, you might create another view just for metrics
    // or run aggregate queries. For now, we'll derive from the list.
    
    const totalAdmissions = admissions.length;
    const totalCollected = admissions.reduce((acc, adm) => acc + adm.total_paid, 0);
    const totalOutstanding = admissions.reduce((acc, adm) => acc + adm.remaining_due, 0);
    const overdueCount = admissions.filter(adm => adm.status === 'Overdue').length;

    // Example: "This Month" metrics
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const admissionsThisMonth = admissions.filter(adm => {
        const admDate = new Date(adm.created_at);
        return admDate.getMonth() === thisMonth && admDate.getFullYear() === thisYear;
    });

    const metrics = {
      totalAdmissions: totalAdmissions,
      admissionsThisMonth: admissionsThisMonth.length,
      totalCollected: totalCollected,
      revenueCollectedThisMonth: admissionsThisMonth.reduce((acc, adm) => acc + adm.total_paid, 0),
      totalOutstanding: totalOutstanding,
      overdueCount: overdueCount
    };

    // --- 3. Send Response ---
    res.status(200).json({
      metrics,
      admissions,
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};