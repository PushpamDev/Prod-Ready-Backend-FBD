// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  // 1. Capture authorization and filter context from query params
  const userLocationId = req.locationId || req.user?.location_id; 
  const { 
    search = '', 
    status, 
    batch, 
    undertaking, 
    startDate, 
    endDate 
  } = req.query;

  if (!userLocationId) {
    return res.status(403).json({ error: 'Access denied: No branch location assigned to user.' });
  }

  try {
    /**
     * ✅ EXTENSIVE DATA FETCHING 
     * We query 'admissions' as base to get 'staff' details.
     * We use !inner join on the view to ensure only records with valid financial data appear.
     */
    let query = supabase
      .from('admissions')
      .select(`
        *,
        staff:admitted_by (
          id,
          username
        ),
        v_admission_financial_summary!inner (
          *
        )
      `)
      .eq('location_id', userLocationId); 

    // ✅ DATE FILTERING
    if (startDate) query = query.gte('date_of_admission', startDate);
    if (endDate) query = query.lte('date_of_admission', endDate);

    // ✅ STATUS FILTER (Paid / Pending)
    if (status && status !== 'all') {
      query = query.eq('v_admission_financial_summary.status', status);
    }

    // ✅ BATCH FILTER
    if (batch && batch !== 'all') {
      query = query.ilike('v_admission_financial_summary.batch_name', `%${batch}%`);
    }

    // ✅ COMPLIANCE FILTER (Undertaking Status)
    if (undertaking && undertaking !== 'all') {
      query = query.eq('v_admission_financial_summary.undertaking_status', undertaking);
    }

    // ✅ SEARCH LOGIC
    if (search) {
      const s = `%${search}%`;
      query = query.or(
        `student_name.ilike.${s},student_phone_number.ilike.${s},admission_number.ilike.${s}`,
        { foreignTable: 'v_admission_financial_summary' }
      );
    }

    // Execution & Sorting
    const { data, error } = await query.order('date_of_admission', { ascending: false });

    if (error) throw error;

    // ✅ 2. DATA MERGING & FLATTENING
    // Fixed: Checking if financial summary is an array or an object
    const admissions = (data || []).map(record => {
      const financial = Array.isArray(record.v_admission_financial_summary)
        ? record.v_admission_financial_summary[0]
        : record.v_admission_financial_summary;

      return {
        ...record,
        ...financial, // Spread view calculations into the top level
        processed_by_name: record.staff?.username || 'System'
      };
    });

    // ✅ 3. METRICS CALCULATION
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const metrics = {
      totalAdmissions: admissions.length,
      
      admissionsThisMonth: admissions.filter(r => {
        if (!r.date_of_admission) return false;
        const d = new Date(r.date_of_admission);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }).length,

      // Total money actually paid by students
      totalCollected: admissions.reduce((sum, r) => sum + Number(r.total_paid || 0), 0),
      
      // Total money still outstanding
      totalOutstanding: admissions.reduce((sum, r) => sum + Number(r.remaining_due || 0), 0),

      // Count students with outstanding balance and 'Pending' status
      overdueCount: admissions.filter(r => 
        (r.status === 'Pending' || r.status === 'Partial') && Number(r.remaining_due || 0) > 0
      ).length,

      // Count students who haven't finished their undertakings
      pendingUndertakings: admissions.filter(r => r.undertaking_status === 'Pending').length,
    };

    // Return combined result
    res.status(200).json({
      metrics,
      admissions: admissions, 
    });

  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ error: 'Critical failure loading dashboard data.' });
  }
};