const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  // 1. Capture authorization context
  const userLocationId = req.locationId || req.user?.location_id; 
  const isSuperAdmin = req.isSuperAdmin; // ✅ From auth middleware

  const { 
    search = '', 
    status, 
    batch, 
    undertaking, 
    startDate, 
    endDate,
    location_id // ✅ Added for Super Admin city filtering
  } = req.query;

  // Standard Admins must have a location assigned
  if (!isSuperAdmin && !userLocationId) {
    return res.status(403).json({ error: 'Access denied: No branch location assigned to user.' });
  }

  try {
    /**
     * ✅ EXTENSIVE DATA FETCHING 
     * We query 'admissions' as base to get 'staff' details.
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
      `);

    // ✅ 🛡️ ROLE-BASED LOCATION FILTERING
    if (isSuperAdmin) {
      // Super Admin: Use specific location_id if provided, else show ALL locations
      if (location_id && location_id !== 'all' && location_id !== 'All') {
        query = query.eq('location_id', Number(location_id));
      }
    } else {
      // Standard Admin: Strictly restricted to their own branch
      query = query.eq('location_id', userLocationId);
    }

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
    const admissions = (data || []).map(record => {
      const financial = Array.isArray(record.v_admission_financial_summary)
        ? record.v_admission_financial_summary[0]
        : record.v_admission_financial_summary;

      return {
        ...record,
        ...financial, 
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

      totalCollected: admissions.reduce((sum, r) => sum + Number(r.total_paid || 0), 0),
      totalOutstanding: admissions.reduce((sum, r) => sum + Number(r.remaining_due || 0), 0),

      overdueCount: admissions.filter(r => 
        (r.status === 'Pending' || r.status === 'Partial') && Number(r.remaining_due || 0) > 0
      ).length,

      pendingUndertakings: admissions.filter(r => r.undertaking_status === 'Pending').length,
    };

    res.status(200).json({
      metrics,
      admissions: admissions, 
    });

  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ error: 'Critical failure loading dashboard data.' });
  }
};