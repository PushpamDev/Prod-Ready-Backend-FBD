const supabase = require('../db');

const getAnnouncements = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('announcements')
            .select(`
                *,
                batch:batches (name)
            `)
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
    const { title, message, scope, batch_id } = req.body;

    if (scope === 'batch' && !batch_id) {
        return res.status(400).json({ error: 'A batch must be selected to create a batch-specific announcement.' });
    }

    try {
        const { data, error } = await supabase
            .from('announcements')
            .insert([{ title, message, scope, batch_id: scope === 'batch' ? batch_id : null }])
            .select();

        if (error) {
            throw error;
        }

        res.status(201).json(data[0]);
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