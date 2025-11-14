const supabase = require('../db.js');

async function getActivities(req, res) {
  try {
    // --- NEW --- This route MUST be protected by auth
    if (!req.locationId) {
      return res.status(401).json({ error: 'Authentication required with location.' });
    }

    const { data, error } = await supabase
      .from('activities')
      .select('action, item, type, created_at')
      .eq('location_id', req.locationId) // --- MODIFIED --- Filter by location
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
}

module.exports = { getActivities };