// server/controllers/ceoDashboardController.js
const supabase = require("../db");

/**
 * @description 
 * Executive Dashboard Controller for Pushpam.
 * REVENUE: Strictly mirrored from v_payments_with_location (Receipt-based).
 * PREDICTED: Strictly mirrored from v_installments_with_location (Plan-based).
 */
exports.getCEODashboard = async (req, res) => {
  // 1. Strict Security: Global Admin Access for Pushpam
  if (req.user?.username !== "pushpam") {
    return res.status(403).json({ error: "Access denied" });
  }

  const { from, to, location } = req.query;

  try {
    let targetLocationId = null;

    // 2. Resolve Branch Context
    if (location && location !== "all") {
      const { data: locData } = await supabase
        .from('locations')
        .select('id')
        .ilike('name', location)
        .maybeSingle();
      if (locData) targetLocationId = locData.id;
    }

    const applyLoc = (query) => (targetLocationId ? query.eq('location_id', targetLocationId) : query);

    // 3. Parallel Execution for Data Integrity
    const [
      studentsRes,
      batchesRes,
      paymentsRes,
      ticketsRes,
      admissionsRes,
      followUpsRes,
      facultyRes,
      projectedRes 
    ] = await Promise.all([
      // Total Students globally or by branch
      applyLoc(supabase.from("students").select("*", { count: "exact", head: true })),
      
      // Active Training Batches
      applyLoc(supabase.from("batches").select("id").eq("status", "active")),
      
      // ✅ REVENUE SOURCE: Strictly actual receipts (matches Ledger exactly)
      applyLoc(supabase.from("v_payments_with_location").select("amount_paid, method"))
        .gte("payment_date", from)
        .lte("payment_date", to),
      
      // Recent Support Tickets
      applyLoc(supabase.from("tickets").select("status"))
        .gte("created_at", from)
        .lte("created_at", to),

      // Admission Funnel Status
      applyLoc(supabase.from("admissions").select("approval_status")),

      // Overdue Follow-up Tasks
      applyLoc(supabase.from("v_follow_up_task_list").select("next_task_due_date")),

      // Faculty Statistics
      applyLoc(supabase.from("faculty").select("id, is_active")),
      
      // ✅ PREDICTED SOURCE: Strictly Unpaid installments in chosen period
      applyLoc(supabase.from("v_installments_with_location").select("amount"))
        .neq("status", "Paid")
        .gte("due_date", from)
        .lte("due_date", to)
    ]);

    // --- AGGREGATION ENGINE ---

    // Total Actual Collection (Mirrors Ledger Total Amount: ₹3,08,500)
    const revenueInPeriod = (paymentsRes.data || []).reduce(
      (sum, p) => sum + Number(p.amount_paid || 0), 0
    );

    // Total Predicted Income (Installments due but not yet 'Paid')
    const predictedRevenue = (projectedRes.data || []).reduce(
      (sum, i) => sum + Number(i.amount || 0), 0
    );

    // Breakdown by specific payment channels
    const paymentMethodsBreakdown = (paymentsRes.data || []).reduce((acc, p) => {
      const method = p.method || 'Other';
      acc[method] = (acc[method] || 0) + Number(p.amount_paid || 0);
      return acc;
    }, {});

    const dashboardStats = {
      overview: {
        totalStudents: studentsRes.count || 0,
        activeBatches: batchesRes.data?.length || 0,
        totalFaculty: facultyRes.data?.length || 0,
        activeFaculty: facultyRes.data?.filter(f => f.is_active).length || 0
      },
      finance: {
        // Core Metric Fix: Receipt-based Revenue
        revenueInPeriod: revenueInPeriod, 
        predictedRevenue: predictedRevenue,
        paymentMethods: paymentMethodsBreakdown
      },
      operations: {
        // Count tasks that missed their 'to' date threshold
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
    res.status(500).json({ error: "Failed to generate unified branch-filtered intelligence report." });
  }
};  