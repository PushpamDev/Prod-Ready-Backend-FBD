// server/controllers/ceoDashboardController.js
const supabase = require("../db");

/**
 * @description 
 * Executive Dashboard Controller for Super Admins.
 * Includes Deep Support Intelligence (Category trends & Assignee performance).
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
  // ✅ ROLE-BASED ACCESS CONTROL: Restricted to super_admin
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: "Access denied. Executive privileges required." });
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
      batchesRes,
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
      
      applyLoc(supabase.from("batches").select("start_date, end_date")),
      
      applyLoc(supabase.from("v_payments_with_location").select("amount_paid, method"))
        .gte("payment_date", from)
        .lte("payment_date", to),
      
      applyLoc(supabase.from("tickets").select(`
        status, 
        category, 
        assignee:users(username)
      `))
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

    // 1. Batch Analytics
    const activeBatchesCount = (batchesRes.data || []).filter(
      batch => getDynamicStatus(batch.start_date, batch.end_date) === 'active'
    ).length;

    // 2. Student Analytics
    const totalEnrolled = admissionsRes.data?.length || 0;
    const totalJoined = (admissionsRes.data || []).filter(a => a.joined === true).length;

    // 3. Financial Analytics
    const revenueInPeriod = (paymentsRes.data || []).reduce(
      (sum, p) => sum + Number(p.amount_paid || 0), 0
    );
    const predictedRevenue = (projectedRes.data || []).reduce(
      (sum, i) => sum + Number(i.amount || 0), 0
    );
    const totalOutstandingDebt = (lifetimeDebtRes.data || []).reduce(
      (sum, i) => sum + Number(i.amount || 0), 0
    );

    // 4. Support Intelligence Analytics
    const ticketData = ticketsRes.data || [];
    const supportStats = {
      totalTickets: ticketData.length,
      statusCount: {
        open: ticketData.filter(t => t.status === "Open").length,
        inProgress: ticketData.filter(t => t.status === "In Progress").length,
        resolved: ticketData.filter(t => t.status === "Resolved").length,
      },
      categoryBreakdown: ticketData.reduce((acc, t) => {
        const cat = t.category || 'Uncategorized';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {}),
      assigneePerformance: ticketData.reduce((acc, t) => {
        if (t.assignee && t.assignee.username) {
          const name = t.assignee.username;
          acc[name] = acc[name] || { total: 0, resolved: 0 };
          acc[name].total += 1;
          if (t.status === "Resolved") acc[name].resolved += 1;
        }
        return acc;
      }, {}),
      resolutionRate: ticketData.length > 0 
        ? ((ticketData.filter(t => t.status === "Resolved").length / ticketData.length) * 100).toFixed(1) 
        : "0"
    };

    // --- FINAL DATA ASSEMBLY ---

    const dashboardStats = {
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
      support: supportStats 
    };

    res.json(dashboardStats);

  } catch (err) {
    console.error("CEO Dashboard Critical Sync Error:", err);
    res.status(500).json({ error: "Failed to generate unified intelligence report." });
  }
};

/**
 * @description Trend Chart API for Executive Intelligence
 */
exports.getCEOTrends = async (req, res) => {
  // ✅ ROLE-BASED ACCESS CONTROL
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: "Access denied. Executive privileges required." });
  }

  const { from, to, location } = req.query;

  try {
    let targetLocationId = null;
    if (location && location !== "all") {
      const { data: locData } = await supabase.from('locations').select('id').ilike('name', location).maybeSingle();
      if (locData) targetLocationId = locData.id;
    }

    const applyLoc = (query) => (targetLocationId ? query.eq('location_id', targetLocationId) : query);

    const [admissions, payments, tickets] = await Promise.all([
      applyLoc(supabase.from("admissions").select("created_at, joined"))
        .gte("created_at", from).lte("created_at", to),
      
      applyLoc(supabase.from("v_payments_with_location").select("payment_date, amount_paid"))
        .gte("payment_date", from).lte("payment_date", to),
      
      applyLoc(supabase.from("tickets").select("created_at, status"))
        .gte("created_at", from).lte("created_at", to)
    ]);

    const trendMap = {};
    let curr = new Date(from);
    const end = new Date(to);
    while (curr <= end) {
      const dateKey = curr.toISOString().split('T')[0];
      trendMap[dateKey] = {
        date: dateKey,
        admissions: 0,
        joined: 0,
        revenue: 0,
        ticketsOpened: 0,
        ticketsResolved: 0
      };
      curr.setDate(curr.getDate() + 1);
    }

    admissions.data?.forEach(a => {
      const date = a.created_at.split('T')[0];
      if (trendMap[date]) {
        trendMap[date].admissions += 1;
        if (a.joined) trendMap[date].joined += 1;
      }
    });

    payments.data?.forEach(p => {
      const date = p.payment_date; 
      if (trendMap[date]) {
        trendMap[date].revenue += Number(p.amount_paid || 0);
      }
    });

    tickets.data?.forEach(t => {
      const date = t.created_at.split('T')[0];
      if (trendMap[date]) {
        trendMap[date].ticketsOpened += 1;
        if (t.status === "Resolved") trendMap[date].ticketsResolved += 1;
      }
    });

    const trendData = Object.values(trendMap).sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(trendData);
  } catch (err) {
    res.status(500).json({ error: "Trend analysis failed." });
  }
};