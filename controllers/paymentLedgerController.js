const supabase = require('../db.js');

/**
 * @description 
 * Fetches all payment records. Now correctly joins students for admission_number.
 */
exports.getPaymentLedger = async (req, res) => {
  const { from, to, location, method, searchTerm, page = 1, limit = 20 } = req.query;
  const locationId = req.locationId;
  const isPushpam = req.user?.username === 'pushpam';

  try {
    let query = supabase
      .from("v_payments_with_location")
      .select("*", { count: "exact" });

    // Branch Security
    if (!isPushpam) {
      if (!locationId) return res.status(403).json({ error: "No branch context." });
      query = query.eq('location_id', locationId);
    }

    // Date Filters
    if (from) query = query.gte("payment_date", from);
    if (to) query = query.lte("payment_date", to);

    // Search (Now safe to use admission_number)
    if (searchTerm) {
      query = query.or(`student_name.ilike.%${searchTerm}%,receipt_number.ilike.%${searchTerm}%,admission_number.ilike.%${searchTerm}%`);
    }

    const start = (page - 1) * limit;
    const end = start + limit - 1;
    
    const { data, count, error } = await query
      .order("payment_date", { ascending: false })
      .range(start, end);

    if (error) throw error;

    res.status(200).json({
      payments: data || [],
      total: count,
      page: Number(page)
    });
  } catch (error) {
    console.error("Ledger Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};