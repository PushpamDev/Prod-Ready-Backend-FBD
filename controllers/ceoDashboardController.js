// server/controllers/ceoDashboardController.js
const supabase = require("../db");

/**
 * @description 
 * Executive Dashboard Controller for Pushpam.
 * REVENUE: Strictly receipt-based from v_payments_with_location.
 * ENROLLED: Total count of records in the admissions table.
 * JOINED: Count of records where 'joined' boolean is TRUE.
 * NET RECEIVABLES: Lifetime unpaid installments (Market Dues).
 */
exports.getCEODashboard = async (req, res) => {
  // 1. Security Check: Lead Developer access only
  if (req.user?.username !== "pushpam") {
    return res.status(403).json({ error: "Access denied" });
  }

  const { from, to, location } = req.query;

  try {
    let targetLocationId = null;

    // 2. Resolve Location Name to ID for filtering
    if (location && location !== "all") {
      const { data: locData, error: locError } = await supabase
        .from('locations')
        .select('id')
        .ilike('name', location)
        .maybeSingle();

      if (locError) throw locError;
      if (locData) targetLocationId = locData.id;
    }

    const applyLoc = (query) => (targetLocationId ? query.eq('location_id', targetLocationId) : query);

    // 3. Parallel Data Fetching for Consistency
    const [
      admissionsRes, 
      batchesRes,
      paymentsRes,
      ticketsRes,
      followUpsRes,
      facultyRes,
      projectedRes,
      lifetimeDebtRes // ✅ NEW: Query for Lifetime Market Dues
    ] = await Promise.all([
      // Fetching approval_status and specific joined boolean
      applyLoc(supabase.from("admissions").select("approval_status, joined")),
      
      // Active Batches from batches table
      applyLoc(supabase.from("batches").select("id").eq("status", "active")),
      
      // Receipt-based Revenue (Matches Payment Ledger)
      applyLoc(supabase.from("v_payments_with_location").select("amount_paid, method"))
        .gte("payment_date", from)
        .lte("payment_date", to),
      
      // Support Tickets in period
      applyLoc(supabase.from("tickets").select("status"))
        .gte("created_at", from)
        .lte("created_at", to),

      // Overdue Follow-up Tasks
      applyLoc(supabase.from("v_follow_up_task_list").select("next_task_due_date")),

      // Faculty Statistics
      applyLoc(supabase.from("faculty").select("id, is_active")),
      
      // ✅ Predicted Revenue: Unpaid installments due in specifically SELECTED period
      applyLoc(supabase.from("v_installments_with_location").select("amount"))
        .neq("status", "Paid")
        .gte("due_date", from)
        .lte("due_date", to),

      // ✅ Net Receivables: Lifetime unpaid installments (No date filter)
      applyLoc(supabase.from("v_installments_with_location").select("amount"))
        .neq("status", "Paid")
    ]);

    // --- AGGREGATION LOGIC ---

    // Enrolled vs Joined Logic
    const totalEnrolled = admissionsRes.data?.length || 0;
    const totalJoined = (admissionsRes.data || []).filter(a => a.joined === true).length;

    // Actual Collection (Matches Ledger ₹3,08,500 logic)
    const revenueInPeriod = (paymentsRes.data || []).reduce(
      (sum, p) => sum + Number(p.amount_paid || 0), 0
    );

    // Expected Collections (Specific to the Date Range)
    const predictedRevenue = (projectedRes.data || []).reduce(
      (sum, i) => sum + Number(i.amount || 0), 0
    );

    // ✅ FIX: Net Receivables (Lifetime Outstanding Debt)
    const totalOutstandingDebt = (lifetimeDebtRes.data || []).reduce(
      (sum, i) => sum + Number(i.amount || 0), 0
    );

    const dashboardStats = {
      overview: {
        totalStudents: totalEnrolled,      
        studentsJoined: totalJoined,        
        activeBatches: batchesRes.data?.length || 0,
        totalFaculty: facultyRes.data?.length || 0,
        activeFaculty: facultyRes.data?.filter(f => f.is_active).length || 0
      },
      finance: {
        revenueInPeriod: revenueInPeriod, 
        predictedRevenue: predictedRevenue,
        totalOutstandingDebt: totalOutstandingDebt, // ✅ Now accurately calculated from installments
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
    console.error("CEO Dashboard Sync Error:", err);
    res.status(500).json({ error: "Failed to generate unified branch intelligence report." });
  }
};