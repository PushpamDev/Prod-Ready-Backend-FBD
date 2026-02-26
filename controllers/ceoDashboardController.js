const supabase = require("../db");

/**
 * @description 
 * Executive Dashboard Controller for Super Admins.
 * Provides unified intelligence across all branches or specific cities.
 */

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
  // ✅ SECURITY: Strict Super Admin Check
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: "Access denied. Executive privileges required." });
  }

  // Location can be an ID or a name depending on your frontend implementation
  const { from, to, location } = req.query;

  try {
    let targetLocationId = null;

    // Resolve Location ID if a name or "all" is passed
    if (location && location !== "all" && location !== "All") {
      // If it's already a number, use it; otherwise, look it up
      if (!isNaN(location)) {
        targetLocationId = Number(location);
      } else {
        const { data: locData } = await supabase
          .from('locations')
          .select('id')
          .ilike('name', location)
          .maybeSingle();
        if (locData) targetLocationId = locData.id;
      }
    }

    // Helper to apply location filter across different tables/views
    const applyLoc = (query) => (targetLocationId ? query.eq('location_id', targetLocationId) : query);

    const [
      admissionsRes, 
      batchesRes,
      paymentsRes,
      ticketsRes,
      followUpsRes,
      facultyRes,
      projectedRes,
      lifetimeDebtRes 
    ] = await Promise.all([
      applyLoc(supabase.from("admissions").select("approval_status, joined, created_at"))
        .gte("created_at", from)
        .lte("created_at", to),
      
      applyLoc(supabase.from("batches").select("start_date, end_date")),
      
      applyLoc(supabase.from("v_payments_with_location").select("amount_paid, method, payment_date"))
        .gte("payment_date", from)
        .lte("payment_date", to),
      
      applyLoc(supabase.from("tickets").select(`
        status, 
        category, 
        assignee:users(username),
        created_at
      `))
        .gte("created_at", from)
        .lte("created_at", to),

      applyLoc(supabase.from("v_follow_up_task_list").select("next_task_due_date")),

      // Faculty are usually linked to locations via a join table or location_id
      applyLoc(supabase.from("users").select("id, is_active, role").eq("role", "faculty")),
      
      applyLoc(supabase.from("v_installments_with_location").select("amount, due_date"))
        .neq("status", "Paid")
        .gte("due_date", from)
        .lte("due_date", to),

      applyLoc(supabase.from("v_installments_with_location").select("amount"))
        .neq("status", "Paid")
    ]);

    // --- ANALYTICS ENGINE ---

    // 1. Operational Analytics
    const activeBatchesCount = (batchesRes.data || []).filter(
      batch => getDynamicStatus(batch.start_date, batch.end_date) === 'active'
    ).length;

    const totalEnrolled = admissionsRes.data?.length || 0;
    const totalJoined = (admissionsRes.data || []).filter(a => a.joined).length;

    // 2. Financial Analytics
    const revenueInPeriod = (paymentsRes.data || []).reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
    const predictedRevenue = (projectedRes.data || []).reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const totalOutstandingDebt = (lifetimeDebtRes.data || []).reduce((sum, i) => sum + Number(i.amount || 0), 0);

    // 3. Support Intelligence (Deep Insights)
    const ticketData = ticketsRes.data || [];
    const supportStats = {
      totalTickets: ticketData.length,
      statusCount: {
        open: ticketData.filter(t => t.status === "Open").length,
        inProgress: ticketData.filter(t => t.status === "In Progress").length,
        resolved: ticketData.filter(t => t.status === "Resolved").length,
      },
      categoryBreakdown: ticketData.reduce((acc, t) => {
        acc[t.category || 'Other'] = (acc[t.category || 'Other'] || 0) + 1;
        return acc;
      }, {}),
      // Monitor which admins are resolving tickets effectively
      assigneePerformance: ticketData.reduce((acc, t) => {
        const name = t.assignee?.username || 'Unassigned';
        acc[name] = acc[name] || { total: 0, resolved: 0 };
        acc[name].total += 1;
        if (t.status === "Resolved") acc[name].resolved += 1;
        return acc;
      }, {}),
      resolutionRate: ticketData.length > 0 
        ? ((ticketData.filter(t => t.status === "Resolved").length / ticketData.length) * 100).toFixed(1) 
        : "0"
    };

    // --- FINAL ASSEMBLY ---

    res.json({
      overview: {
        totalStudents: totalEnrolled,      
        studentsJoined: totalJoined,        
        activeBatches: activeBatchesCount,
        totalFaculty: facultyRes.data?.length || 0,
        activeFaculty: facultyRes.data?.filter(f => f.is_active).length || 0
      },
      finance: {
        revenueInPeriod, 
        predictedRevenue,
        totalOutstandingDebt,
        paymentMethods: (paymentsRes.data || []).reduce((acc, p) => {
          acc[p.method || 'Other'] = (acc[p.method || 'Other'] || 0) + Number(p.amount_paid || 0);
          return acc;
        }, {})
      },
      operations: {
        overdueFollowUps: (followUpsRes.data || []).filter(
          f => f.next_task_due_date && new Date(f.next_task_due_date) < new Date()
        ).length,
        admissionStatus: (admissionsRes.data || []).reduce((acc, a) => {
          acc[a.approval_status || 'Pending'] = (acc[a.approval_status || 'Pending'] || 0) + 1;
          return acc;
        }, {})
      },
      support: supportStats 
    });

  } catch (err) {
    console.error("CEO Dashboard Intelligence Error:", err);
    res.status(500).json({ error: "Critical error generating intelligence report." });
  }
};

/**
 * @description Trend Chart API for Executive Intelligence
 */
exports.getCEOTrends = async (req, res) => {
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: "Access denied." });
  }

  const { from, to, location } = req.query;

  try {
    let targetLocationId = null;
    if (location && location !== "all" && location !== "All") {
      if (!isNaN(location)) targetLocationId = Number(location);
      else {
        const { data: locData } = await supabase.from('locations').select('id').ilike('name', location).maybeSingle();
        if (locData) targetLocationId = locData.id;
      }
    }

    const applyLoc = (query) => (targetLocationId ? query.eq('location_id', targetLocationId) : query);

    const [admissions, payments, tickets] = await Promise.all([
      applyLoc(supabase.from("admissions").select("created_at, joined")).gte("created_at", from).lte("created_at", to),
      applyLoc(supabase.from("v_payments_with_location").select("payment_date, amount_paid")).gte("payment_date", from).lte("payment_date", to),
      applyLoc(supabase.from("tickets").select("created_at, status")).gte("created_at", from).lte("created_at", to)
    ]);

    // Build Time-Series Map
    const trendMap = {};
    let curr = new Date(from);
    const end = new Date(to);
    while (curr <= end) {
      const dateKey = curr.toISOString().split('T')[0];
      trendMap[dateKey] = { date: dateKey, admissions: 0, joined: 0, revenue: 0, ticketsOpened: 0, ticketsResolved: 0 };
      curr.setDate(curr.getDate() + 1);
    }

    admissions.data?.forEach(a => {
      const d = a.created_at.split('T')[0];
      if (trendMap[d]) { trendMap[d].admissions++; if (a.joined) trendMap[d].joined++; }
    });

    payments.data?.forEach(p => {
      const d = p.payment_date; 
      if (trendMap[d]) trendMap[d].revenue += Number(p.amount_paid || 0);
    });

    tickets.data?.forEach(t => {
      const d = t.created_at.split('T')[0];
      if (trendMap[d]) { trendMap[d].ticketsOpened++; if (t.status === "Resolved") trendMap[d].ticketsResolved++; }
    });

    res.json(Object.values(trendMap).sort((a, b) => new Date(a.date) - new Date(b.date)));
  } catch (err) {
    console.error("Trend Analysis Error:", err);
    res.status(500).json({ error: "Trend analysis failed." });
  }
};