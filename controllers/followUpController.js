// Import the configured Supabase client from your db setup file
const supabase = require('../db');

/**
 * @description Get the automated list of admissions needing a FEE payment follow-up.
 * This endpoint leverages the `v_follow_up_list` view for efficiency.
 * FIXED: Renamed from getFeeFollowUpList to getFollowUpList to match the router.
 */
exports.getFollowUpList = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('v_follow_up_list')
            .select('*')
            .order('total_amount_overdue', { ascending: false });

        if (error) throw error;

        // Note: Currency formatting can be done here if needed, or on the client.
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching fee follow-up list:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * @description Get the complete CRM follow-up history for a single admission.
 */
exports.getFollowUpsForAdmission = async (req, res) => {
    const { admissionId } = req.params;
    try {
        const { data, error } = await supabase
            .from('follow_ups')
            .select(`
                *,
                user:users ( username )
            `)
            .eq('admission_id', admissionId)
            .order('follow_up_date', { ascending: false });

        if (error) throw error;

        // Clean up the data structure for the frontend
        const formattedData = data.map(f => ({
            ...f,
            user_name: f.user ? f.user.username : 'Deleted User',
            user: undefined
        }));

        res.status(200).json(formattedData);
    } catch (error) {
        console.error(`Error fetching follow-ups for admission ${admissionId}:`, error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * @description Create a new CRM follow-up note for an admission.
 */
exports.createFollowUp = async (req, res) => {
    const { admission_id, follow_up_date, notes } = req.body;
    // Get user_id from the auth middleware
    const user_id = req.user?.id;

    if (!admission_id || !follow_up_date || !user_id) {
        return res.status(400).json({ error: 'admission_id, follow_up_date, and user_id are required.' });
    }
    if (isNaN(Date.parse(follow_up_date))) {
        return res.status(400).json({ error: 'Please provide a valid follow_up_date.' });
    }

    try {
        const { data, error } = await supabase
            .from('follow_ups')
            .insert({
                admission_id,
                follow_up_date,
                notes: notes || '',
                user_id
            })
            .select()
            .single();

        if (error) throw error;
        
        res.status(201).json(data);
    } catch (error) {
        console.error('Error creating follow-up:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(404).json({ error: 'The specified admission or user does not exist.' });
        }
        res.status(500).json({ error: 'An error occurred while creating the follow-up.' });
    }
};

