// server/controllers/announcementController.js
const supabase = require('../db');

const getAnnouncements = async (req, res) => {
    try {
        if (!req.locationId) {
            return res.status(401).json({ error: 'Authentication required with location.' });
        }

        // Logic: Get all "general" announcements for the location 
        // OR batch-specific ones if requested (optional logic adjustment)
        const { data, error } = await supabase
            .from('announcements')
            .select(`
                *,
                batch:batches (name)
            `)
            .eq('location_id', req.locationId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createAnnouncement = async (req, res) => {
    if (!req.locationId) {
        return res.status(401).json({ error: 'Authentication required with location.' });
    }

    const { title, message, scope, batch_id } = req.body;

    if (scope === 'batch' && !batch_id) {
        return res.status(400).json({ error: 'A batch must be selected for batch-specific announcements.' });
    }

    try {
        const announcementData = {
            title,
            message,
            scope,
            batch_id: scope === 'batch' ? batch_id : null,
            location_id: req.locationId
        };

        const { data, error } = await supabase
            .from('announcements')
            .insert([announcementData])
            .select(`
                *,
                batch:batches (name)
            `) // Join batch name immediately so frontend can display it without refresh
            .single();

        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteAnnouncement = async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase
            .from('announcements')
            .delete()
            .eq('id', id);

        if (error) throw error;
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