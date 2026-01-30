const supabase = require('../db.js');

/**
 * @description 
 * Fetches all payment records with a total collection sum for auditing.
 */
exports.getPaymentLedger = async (req, res) => {
  const { from, to, location, method, searchTerm, page = 1, limit = 20 } = req.query;
  const locationId = req.locationId;
  const isPushpam = req.user?.username === 'pushpam';

  try {
    // 1. Base Query Setup
    let query = supabase
      .from("v_payments_with_location")
      .select("*", { count: "exact" });

    // 2. Apply Filters (Shared by both data and total sum)
    if (!isPushpam) {
      if (!locationId) return res.status(403).json({ error: "No branch context." });
      query = query.eq('location_id', locationId);
    } else if (location && location !== 'all') {
      query = query.eq('location_name', location);
    }

    if (from) query = query.gte("payment_date", from);
    if (to) query = query.lte("payment_date", to);
    if (method && method !== 'all') query = query.eq("method", method);

    if (searchTerm) {
      query = query.or(`student_name.ilike.%${searchTerm}%,receipt_number.ilike.%${searchTerm}%,admission_number.ilike.%${searchTerm}%`);
    }

    // 3. FETCH DATA (Paginated)
    const start = (page - 1) * limit;
    const end = start + limit - 1;
    
    const { data: payments, count, error: dataError } = await query
      .order("payment_date", { ascending: false })
      // Adding secondary order to keep receipts in sequence if dates are same
      .order("receipt_number", { ascending: false })
      .range(start, end);

    if (dataError) throw dataError;

    // 4. CALCULATE TOTAL COLLECTION (Aggregated for the filtered period)
    // We run a separate slim query to get the sum of the 'amount_paid' column
    const { data: totalsData, error: totalError } = await query.select('amount_paid');
    
    if (totalError) throw totalError;

    const totalAmount = (totalsData || []).reduce((sum, p) => sum + Number(p.amount_paid), 0);

    // 5. Response compatible with your frontend meta-cards
    res.status(200).json({
      payments: payments || [],
      total: count,
      page: Number(page),
      meta: {
        totalAmount: totalAmount, // This is what your frontend 'Total Collection' card needs
        totalRecords: count
      }
    });

  } catch (error) {
    console.error("Ledger Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};