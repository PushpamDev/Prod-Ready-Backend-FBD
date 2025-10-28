const supabase = require('../db');

/**
 * @description Get all data for the admissions dashboard.
 * Calls a single PostgreSQL function to do all the heavy lifting.
 */
exports.getDashboardSummary = async (req, res) => {
  // Get search term from query, default to empty string
  const search_term = req.query.search || '';

  try {
    const { data, error } = await supabase.rpc('get_admission_dashboard', {
      search_term: search_term
    });

    if (error) throw error;

    // The function returns a single JSON object with 'metrics' and 'admissions' keys
    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};