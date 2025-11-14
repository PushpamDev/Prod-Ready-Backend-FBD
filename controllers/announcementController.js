const supabase = require('../db');

const getAnnouncements = async (req, res) => {
    try {
        // --- NEW --- This route MUST be protected by auth
        if (!req.locationId) {
            return res.status(401).json({ error: 'Authentication required with location.' });
        }

        const { data, error } = await supabase
            .from('announcements')
            .select(`
                *,
                batch:batches (name)
            `)
            .eq('location_id', req.locationId) // --- MODIFIED --- Filter by location
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createAnnouncement = async (req, res) => {
    // --- NEW --- This route MUST be protected by auth
    if (!req.locationId) {
        return res.status(401).json({ error: 'Authentication required with location.' });
    }

    const { title, message, scope, batch_id } = req.body;

    if (scope === 'batch' && !batch_id) {
        return res.status(400).json({ error: 'A batch must be selected to create a batch-specific announcement.' });
    }

    try {
        const announcementData = {
            title,
            message,
            scope,
            batch_id: scope === 'batch' ? batch_id : null,
            location_id: req.locationId // --- MODIFIED --- Add the location ID
        };

        const { data, error } = await supabase
            .from('announcements')
            .insert([announcementData])
            .select()
            .single(); // --- MODIFIED --- .single() is better if you expect one row

        if (error) {
            throw error;
        }

        res.status(201).json(data); // --- MODIFIED --- Send the single object
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteAnnouncement = async (req, res) => {
    // --- NO CHANGE NEEDED ---
    // Deleting by a unique 'id' (UUID) is safe.
    // The user should only see/get IDs for their own location,
    // so this is implicitly secure.
    const { id } = req.params;

    try {
        const { error } = await supabase
            .from('announcements')
            .delete()
            .eq('id', id);

        if (error) {
            throw error;
        }

        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getAnnouncements,
    createAnnouncement,
    deleteAnnouncement,
};