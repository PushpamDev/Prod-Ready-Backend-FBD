// server/controllers/ceoDashboardController.js
const supabase = require("../db");

/**
 * @description 
 * Fetches comprehensive executive metrics for Pushpam.
 * Includes revenue, overdue tasks, ticket support, and period-specific collection predictions.
 * [UPDATED] Metrics now dynamically align with the selected 'from' and 'to' date range.
 */
exports.getCEODashboard = async (req, res) => {
  // --- Security Check ---
  // Ensuring only the lead developer (Pushpam) has access to global financial data.
  if (req.user?.username !== "pushpam") {
    return res.status(403).json({ error: "Access denied" });
  }

  const { from, to, location } = req.query;

  try {
    let targetLocationId = null;

    // 1. Resolve Location Name to ID (Branch Filtering)
    if (location && location !== "all") {
      const { data: locData, error: locError } = await supabase
        .from('locations')
        .select('id')
        .ilike('name', location)
        .maybeSingle();

      if (locError) throw locError;

      if (!locData) {
        return res.status(404).json({ error: `Location '${location}' not found.` });
      }
      targetLocationId = locData.id;
    }

    // Helper to apply location filter if targetLocationId exists
    const applyLoc = (query) => (targetLocationId ? query.eq('location_id', targetLocationId) : query);

    // 2. Parallel Execution for High Performance
    const [
      studentsRes,
      batchesRes,
      paymentsRes,
      ticketsRes,
      financialsRes,
      followUpsRes,
      facultyRes,
      projectedRes 
    ] = await Promise.all([
      // A. Total Student Count
      applyLoc(supabase.from("students").select("*", { count: "exact", head: true })),
      
      // B. Active Batches
      applyLoc(supabase.from("batches").select("id").eq("status", "active")),
      
      // C. Revenue Collected in the selected period
      applyLoc(supabase.from("v_payments_with_location").select("amount_paid, method"))
        .gte("payment_date", from)
        .lte("payment_date", to),
      
      // D. Support Tickets in the selected period
      applyLoc(supabase.from("tickets").select("status"))
        .gte("created_at", from)
        .lte("created_at", to),

      // E. Outstanding Debt (Current Snapshot)
      applyLoc(supabase.from("v_admission_financial_summary").select("remaining_due, status")),

      // F. Overdue Tasks list for the operations count
      applyLoc(supabase.from("v_follow_up_task_list").select("next_task_due_date")),

      // G. Faculty Stats
      applyLoc(supabase.from("faculty").select("id, is_active")),

      // H. UPDATED: Prediction based on the SELECTED date range instead of hardcoded 30 days
      applyLoc(supabase.from("v_installments_with_location").select("amount"))
        .neq("status", "Paid")
        .gte("due_date", from)
        .lte("due_date", to)
    ]);

    // --- AGGREGATION & DATA PROCESSING ---

    const dashboardStats = {
      overview: {
        totalStudents: studentsRes.count || 0,
        activeBatches: batchesRes.data?.length || 0,
        totalFaculty: facultyRes.data?.length || 0,
        activeFaculty: facultyRes.data?.filter(f => f.is_active).length || 0
      },
      finance: {
        revenueInPeriod: paymentsRes.data?.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0) || 0,
        totalOutstandingDebt: financialsRes.data?.reduce((sum, a) => sum + Number(a.remaining_due || 0), 0) || 0,
        
        // UPDATED: Now represents expected collections for the SPECIFIC period chosen in the UI
        predictedRevenue: projectedRes.data?.reduce((sum, i) => sum + Number(i.amount || 0), 0) || 0,
        
        paymentMethods: paymentsRes.data?.reduce((acc, p) => {
          acc[p.method] = (acc[p.method] || 0) + Number(p.amount_paid);
          return acc;
        }, {}) || {}
      },
      operations: {
        // UPDATED: Count tasks overdue relative to the END of the selected period ('to')
        overdueCollectionsCount: followUpsRes.data?.filter(f => f.next_task_due_date && f.next_task_due_date < to).length || 0,
        
        admissionStatusBreakdown: financialsRes.data?.reduce((acc, a) => {
          acc[a.status] = (acc[a.status] || 0) + 1;
          return acc;
        }, {}) || {}
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
    console.error("Critical CEO Dashboard Error:", err);
    res.status(500).json({ error: "Failed to generate branch-filtered report." });
  }
};