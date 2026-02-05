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
     * We query 'admissions' as base to get 'admitted_by' tracking.
     * We inner join 'v_admission_financial_summary' for financial metrics.
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
    // Applied to the physical admissions table column
    if (startDate) {
      query = query.gte('date_of_admission', startDate);
    }
    if (endDate) {
      query = query.lte('date_of_admission', endDate);
    }

    // ✅ STATUS FILTER (Paid / Pending)
    // Applied to the calculated status in the view
    if (status && status !== 'all') {
      query = query.eq('v_admission_financial_summary.status', status);
    }

    // ✅ BATCH FILTER
    // ilike search on batch_preference (from admissions) or batch_name (from view)
    if (batch && batch !== 'all') {
      query = query.ilike('v_admission_financial_summary.batch_name', `%${batch}%`);
    }

    // ✅ COMPLIANCE FILTER (Undertaking Status)
    if (undertaking && undertaking !== 'all') {
      query = query.eq('v_admission_financial_summary.undertaking_status', undertaking);
    }

// ✅ FIXED SEARCH LOGIC (Works with joined views)
    // ✅ SAFE SEARCH LOGIC (Supabase-correct)
// ✅ CORRECT SEARCH (single OR, single table)
if (search) {
  const s = `%${search}%`;

  query = query.or(
    `student_name.ilike.${s},` +
    `student_phone_number.ilike.${s},` +
    `admission_number.ilike.${s}`,
    { foreignTable: 'v_admission_financial_summary' }
  );
}


    // Execution & Sorting
    const { data, error } = await query.order('date_of_admission', { ascending: false });

    if (error) throw error;

    // ✅ 2. DATA MERGING & FLATTENING
    // This merges biographical table data with view-derived financial calculations
    const uniqueAdmissionsMap = new Map();
    
    data.forEach(record => {
      const financial = record.v_admission_financial_summary?.[0] || {};
      
      const admissionRecord = {
        // Biographical/Physical: id, student_name, father_name, address, id_number, etc.
        ...record,
        // Financial/Calculated: total_paid, balance_due, courses_str, batch_name, status
        ...financial,
        // Tracking: The staff username who entered the data
        processed_by_name: record.staff?.username || 'System'
      };

      // De-duplication check: Ensure we only have one row per admission ID
      const existing = uniqueAdmissionsMap.get(record.id);
      if (!existing || (Number(admissionRecord.total_paid) > Number(existing.total_paid))) {
        uniqueAdmissionsMap.set(record.id, admissionRecord);
      }
    });

    const admissions = Array.from(uniqueAdmissionsMap.values());

    // ✅ 3. METRICS CALCULATION (Dynamic for Dashboard Cards)
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const metrics = {
      totalAdmissions: admissions.length,
      
      admissionsThisMonth: admissions.filter(r => {
        const d = new Date(r.date_of_admission);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      }).length,

      totalCollected: admissions.reduce((sum, r) => sum + Number(r.total_paid || 0), 0),
      
      totalOutstanding: admissions.reduce((sum, r) => sum + Number(r.remaining_due || 0), 0),

      // Count students with outstanding balance and 'Pending' status
      overdueCount: admissions.filter(r => r.status === 'Pending' && r.remaining_due > 0).length,

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