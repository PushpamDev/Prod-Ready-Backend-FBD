const supabase = require('../db');

/**
 * @description Create a new certificate.
 */
exports.createCertificate = async (req, res) => {
    const { name, cost } = req.body;

    if (!name || !cost) {
        return res.status(400).json({ error: 'Name and cost are required.' });
    }
    if (isNaN(parseFloat(cost)) || parseFloat(cost) < 0) {
        return res.status(400).json({ error: 'Cost must be a non-negative number.' });
    }

    try {
        const { data, error } = await supabase
            .from('certificates')
            .insert([{ name, cost }])
            .select();

        if (error) throw error;

        res.status(201).json({ message: 'Certificate created successfully', certificate: data[0] });
    } catch (error) {
        console.error('Error creating certificate:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'A certificate with this name already exists.' });
        }
        res.status(500).json({ error: 'An error occurred while creating the certificate.' });
    }
};

/**
 * @description Get all certificates.
 */
exports.getAllCertificates = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('certificates')
            .select('*')
            .order('name', { ascending: true });

        if (error) throw error;

        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching certificates:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * @description Get a single certificate by its ID.
 */
exports.getCertificateById = async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from('certificates')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: 'Certificate not found.' });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error(`Error fetching certificate with id ${id}:`, error);
        if (error.code === 'PGRST116') { // Not found with .single()
            return res.status(404).json({ error: 'Certificate not found' });
        }
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * @description Update a certificate's details.
 */
exports.updateCertificate = async (req, res) => {
    const { id } = req.params;
    const { name, cost } = req.body;

    if (!name && !cost) {
        return res.status(400).json({ error: 'At least one field (name or cost) must be provided for an update.' });
    }
    if (cost && (isNaN(parseFloat(cost)) || parseFloat(cost) < 0)) {
        return res.status(400).json({ error: 'Cost must be a non-negative number.' });
    }

    try {
        const { data, error } = await supabase
            .from('certificates')
            .update({ name, cost })
            .eq('id', id)
            .select();

        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Certificate not found.' });
        }

        res.status(200).json({ message: 'Certificate updated successfully', certificate: data[0] });
    } catch (error) {
        console.error(`Error updating certificate with id ${id}:`, error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'A certificate with this name already exists.' });
        }
        res.status(500).json({ error: 'An error occurred while updating the certificate.' });
    }
};

/**
 * @description Delete a certificate by its ID.
 */
exports.deleteCertificate = async (req, res) => {
    const { id } = req.params;

    try {
        const { error, count } = await supabase
            .from('certificates')
            .delete({ count: 'exact' })
            .eq('id', id);

        if (error) throw error;

        if (count === 0) {
            return res.status(404).json({ error: 'Certificate not found.' });
        }

        res.status(200).json({ message: 'Certificate deleted successfully' });
    } catch (error) {
        console.error(`Error deleting certificate with id ${id}:`, error);
        res.status(500).json({ error: 'An error occurred while deleting the certificate.' });
    }
};