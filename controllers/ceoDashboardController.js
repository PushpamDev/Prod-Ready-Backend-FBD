// server/controllers/ceoDashboardController.js
const supabase = require("../db");

/**
 * @description 
 * Executive Dashboard Controller for Pushpam.
 * Uses getDynamicStatus helper to calculate Active Batches in real-time.
 */

// ✅ INTEGRATED: Your dynamic status helper
const getDynamicStatus = (startDate, endDate) => {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  now.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'active';
  return 'completed';
};

exports.getCEODashboard = async (req, res) => {
  if (req.user?.username !== "pushpam") {
    return res.status(403).json({ error: "Access denied" });
  }

  const { from, to, location } = req.query;

  try {
    let targetLocationId = null;

    if (location && location !== "all") {
      const { data: locData } = await supabase
        .from('locations')
        .select('id')
        .ilike('name', location)
        .maybeSingle();
      if (locData) targetLocationId = locData.id;
    }

    const applyLoc = (query) => (targetLocationId ? query.eq('location_id', targetLocationId) : query);

    const [
      admissionsRes, 
      batchesRes, // ✅ FETCHING raw data for status calculation
      paymentsRes,
      ticketsRes,
      followUpsRes,
      facultyRes,
      projectedRes,
      lifetimeDebtRes 
    ] = await Promise.all([
      applyLoc(supabase.from("admissions").select("approval_status, joined"))
        .gte("created_at", from)
        .lte("created_at", to),
      
      // ✅ MODIFIED: Fetch start/end dates to apply dynamic logic
      applyLoc(supabase.from("batches").select("start_date, end_date")),
      
      applyLoc(supabase.from("v_payments_with_location").select("amount_paid, method"))
        .gte("payment_date", from)
        .lte("payment_date", to),
      
      applyLoc(supabase.from("tickets").select("status"))
        .gte("created_at", from)
        .lte("created_at", to),

      applyLoc(supabase.from("v_follow_up_task_list").select("next_task_due_date")),

      applyLoc(supabase.from("faculty").select("id, is_active")),
      
      applyLoc(supabase.from("v_installments_with_location").select("amount"))
        .neq("status", "Paid")
        .gte("due_date", from)
        .lte("due_date", to),

      applyLoc(supabase.from("v_installments_with_location").select("amount"))
        .neq("status", "Paid")
    ]);

    // --- AGGREGATION ENGINE ---

    // ✅ DYNAMIC BATCH CALCULATION
    const activeBatchesCount = (batchesRes.data || []).filter(
      batch => getDynamicStatus(batch.start_date, batch.end_date) === 'active'
    ).length;

    const totalEnrolled = admissionsRes.data?.length || 0;
    const totalJoined = (admissionsRes.data || []).filter(a => a.joined === true).length;

    const revenueInPeriod = (paymentsRes.data || []).reduce(
      (sum, p) => sum + Number(p.amount_paid || 0), 0
    );

    const predictedRevenue = (projectedRes.data || []).reduce(
      (sum, i) => sum + Number(i.amount || 0), 0
    );

    const totalOutstandingDebt = (lifetimeDebtRes.data || []).reduce(
      (sum, i) => sum + Number(i.amount || 0), 0
    );

    const dashboardStats = {
      overview: {
        totalStudents: totalEnrolled,      
        studentsJoined: totalJoined,        
        activeBatches: activeBatchesCount, // ✅ Real-time calculated status
        totalFaculty: facultyRes.data?.length || 0,
        activeFaculty: facultyRes.data?.filter(f => f.is_active).length || 0
      },
      finance: {
        revenueInPeriod, 
        predictedRevenue,
        totalOutstandingDebt,
        paymentMethods: (paymentsRes.data || []).reduce((acc, p) => {
          const method = p.method || 'Other';
          acc[method] = (acc[method] || 0) + Number(p.amount_paid || 0);
          return acc;
        }, {})
      },
      operations: {
        overdueCollectionsCount: (followUpsRes.data || []).filter(
          f => f.next_task_due_date && f.next_task_due_date < to
        ).length,
        
        admissionStatusBreakdown: (admissionsRes.data || []).reduce((acc, a) => {
          const status = a.approval_status || 'Pending';
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {})
      },
      support: {
        totalTickets: ticketsRes.data?.length || 0,
        resolutionRate: ticketsRes.data?.length > 0 
          ? ((ticketsRes.data.filter(t => t.status === "Resolved").length / ticketsRes.data.length) * 100).toFixed(2) 
          : "0",
        unresolvedTickets: ticketsRes.data?.filter(t => t.status !== "Resolved").length || 0
      }
    };

    res.json(dashboardStats);

  } catch (err) {
    console.error("CEO Dashboard Critical Sync Error:", err);
    res.status(500).json({ error: "Failed to generate unified intelligence report." });
  }
};