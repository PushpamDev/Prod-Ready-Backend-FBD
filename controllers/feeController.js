// Import the configured Supabase client from your db setup file
const supabase = require('../db');

/**
 * A simple utility function to format numeric values into Indian Rupee (INR) currency format.
 */
const formatToINR = (amount) => {
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount)) {
    return amount;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(numericAmount);
};

/**
 * @description Record a new payment by calling the database function via Supabase RPC.
 */
exports.recordPayment = async (req, res) => {
    const { admission_id, amount_paid, payment_date, payment_method } = req.body;
    // Correctly get user_id from the auth middleware attached to the request
    const user_id = req.user?.id;

    if (!admission_id || !amount_paid || !payment_date || !user_id) {
        return res.status(400).json({ error: 'admission_id, amount_paid, payment_date, and user_id are required.' });
    }
    if (isNaN(parseFloat(amount_paid)) || parseFloat(amount_paid) <= 0) {
        return res.status(400).json({ error: 'Amount paid must be a positive number.' });
    }

    try {
        const { data, error } = await supabase.rpc('record_payment', {
            p_admission_id: admission_id,
            p_amount_paid: amount_paid,
            p_payment_date: payment_date,
            p_payment_method: payment_method || 'Cash',
            p_user_id: user_id
        });

        if (error) throw error;

        res.status(201).json({ message: 'Payment recorded successfully', receipt_id: data });
    } catch (error) {
        console.error('Error recording payment:', error);
        if (error.message?.includes('foreign key constraint')) {
            return res.status(404).json({ error: 'Admission with the provided ID not found.' });
        }
        res.status(500).json({ error: 'An error occurred while recording the payment.' });
    }
};

/**
 * @description Get all receipts for a specific admission using Supabase client.
 */
exports.getReceiptsForAdmission = async (req, res) => {
    const { admissionId } = req.params;
    try {
        const { data, error } = await supabase
            .from('receipts')
            .select('*')
            .eq('admission_id', admissionId)
            .order('payment_date', { ascending: false });

        if (error) throw error;

        const formattedRows = data.map(row => ({
            ...row,
            amount_paid_formatted: formatToINR(row.amount_paid)
        }));
        res.status(200).json(formattedRows);
    } catch (error) {
        console.error(`Error fetching receipts for admission ${admissionId}:`, error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * @description Get details of a single receipt using Supabase nested selects for efficiency.
 */
exports.getReceiptDetails = async (req, res) => {
    const { receiptId } = req.params;
    try {
        const { data, error } = await supabase
            .from('receipts')
            .select(`
                *,
                admission:admissions(*, student:students(name)),
                applied_installments:receipt_installments(
                    amount_applied,
                    installment:fee_installments(
                        due_date,
                        amount_due
                    )
                )
            `)
            .eq('id', receiptId)
            .single();

        if (error) throw error;

        // Restructure the data to be more frontend-friendly
        const receiptDetails = {
            ...data,
            amount_paid_formatted: formatToINR(data.amount_paid),
            admission_summary: {
                admission_id: data.admission.id,
                student_name: data.admission.student.name,
                // Include other admission fields as needed
            },
            applied_to_installments: data.applied_installments.map(item => ({
                installment_id: item.installment.id,
                due_date: item.installment.due_date,
                amount_due: item.installment.amount_due,
                amount_applied: item.amount_applied
            })),
            admission: undefined, // remove redundant nested object
            applied_installments: undefined // remove redundant nested object
        };

        res.status(200).json(receiptDetails);
    } catch (error) {
        console.error(`Error fetching receipt details for ${receiptId}:`, error);
        if (error.code === 'PGRST116') { // Not found with .single()
            return res.status(404).json({ error: 'Receipt not found' });
        }
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * @description Get all fee installments for an admission using Supabase client.
 */
exports.getInstallmentsForAdmission = async (req, res) => {
    const { admissionId } = req.params;
    try {
        const { data, error } = await supabase
            .from('v_installment_status')
            .select('*')
            .eq('admission_id', admissionId)
            .order('due_date', { ascending: true });

        if (error) throw error;

        const formattedRows = data.map(row => ({
            ...row,
            amount_due_formatted: formatToINR(row.amount_due),
            amount_paid_formatted: formatToINR(row.amount_paid),
            balance_due_formatted: formatToINR(row.balance_due)
        }));
        res.status(200).json(formattedRows);
    } catch (error) {
        console.error(`Error fetching installments for admission ${admissionId}:`, error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

