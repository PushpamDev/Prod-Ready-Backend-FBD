// controllers/accountsController.js
const supabase = require('../db');

/**
 * @description Get admissions list for the approval page or general accounts view.
 * Filters by status ('Pending', 'Approved', 'Rejected', 'All').
 * Fetches summary data using the financial view.
 */
exports.getAdmissionsForAccounts = async (req, res) => {
  const { status = 'Approved', search = '' } = req.query; // Default to 'Approved' for Accounts Page

  try {
    let query = supabase
      .from('v_admission_financial_summary') // Use the summary view for efficiency
      .select(
        // CORRECTED: Select 'created_at' instead of 'date_of_admission' from the view
        'admission_id, student_name, student_phone_number, created_at, total_payable_amount, total_paid, remaining_due, approval_status'
      );

    if (status && status !== 'All') {
      query = query.eq('approval_status', status);
    }

    if (search) {
      query = query.or(
        `student_name.ilike.%${search}%,student_phone_number.ilike.%${search}%`
      );
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Format data for frontend tables
    const formattedData = data.map((adm) => ({
      id: adm.admission_id,
      name: adm.student_name || 'N/A',
      // CORRECTED: Map the 'created_at' column to 'admission_date' for the frontend
      admission_date: adm.created_at,
      final_fees: adm.total_payable_amount, // Renamed for frontend consistency
      total_payable_amount: adm.total_payable_amount,
      total_paid: adm.total_paid,
      balance: adm.remaining_due,
      approval_status: adm.approval_status,
      phone_number: adm.student_phone_number || 'N/A',
    }));

    res.status(200).json(formattedData);
  } catch (error) {
    console.error('Error fetching admissions for accounts:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Approve an admission. (No GST logic here anymore)
 * Sets status to Approved. Assumes final amount calculation happened during creation or elsewhere.
 */
exports.approveAdmission = async (req, res) => {
  const { admissionId } = req.params;
  // Removed GST fields from req.body for this simplified version

  try {
    // Fetch the admission to ensure total_payable_amount is set
    const { data: admissionData, error: fetchError } = await supabase
        .from('admissions')
        .select('total_payable_amount') // Ensure this field has the final calculated value
        .eq('id', admissionId)
        .single();

    if (fetchError || !admissionData) {
         return res.status(404).json({ error: 'Admission not found.' });
    }
     // Optional: You could still add a check here if total_payable_amount looks unset (e.g., is 0 or null)
     // if (!admissionData.total_payable_amount) {
     //     return res.status(400).json({ error: 'Final payable amount not set for this admission.'});
     // }


    const { data, error } = await supabase
      .from('admissions')
      .update({
        approval_status: 'Approved',
        // Clear rejection reason if previously rejected
        rejection_reason: null,
        // GST fields (is_gst_exempt, gst_rate) should be set during creation or via a separate update if needed
        // total_payable_amount is assumed to be correctly calculated already
      })
      .eq('id', admissionId)
      .eq('approval_status', 'Pending') // Only approve pending ones
      .select('id')
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'Admission not found or not in Pending state.' });
    }

    res.status(200).json({ message: 'Admission approved successfully.', data });
  } catch (error) {
    console.error(`Error approving admission ${admissionId}:`, error);
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Admission not found or not in Pending state.' });
    }
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};


/**
 * @description Reject an admission. (No change)
 */
exports.rejectAdmission = async (req, res) => {
    const { admissionId } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
        return res.status(400).json({ error: 'Rejection reason is required.' });
    }
    try {
        const { data, error } = await supabase
            .from('admissions')
            .update({
                approval_status: 'Rejected',
                rejection_reason: rejection_reason
            })
            .eq('id', admissionId)
            .eq('approval_status', 'Pending')
            .select('id')
            .single();

        if (error) throw error;
        if (!data) {
           return res.status(404).json({ error: 'Admission not found or not in Pending state.' });
        }
        res.status(200).json({ message: 'Admission rejected successfully.' });
    } catch (error) {
        console.error(`Error rejecting admission ${admissionId}:`, error);
        if (error.code === 'PGRST116') {
            return res.status(404).json({ error: 'Admission not found or not in Pending state.' });
        }
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * @description [CONSOLIDATED] Record a payment for an admission.
 * This is the single endpoint for recording payments.
 * CRITICAL: Calls a database function to update installment statuses.
 */
exports.recordPayment = async (req, res) => {
    const { admission_id, amount_paid, payment_date, method, receipt_number, notes } = req.body;
    const user_id = req.user?.id;

    // Validation (same as before)
    if (!admission_id || !amount_paid || !payment_date || !method || !user_id) {
        return res.status(400).json({ error: 'admission_id, amount_paid, payment_date, method, and user_id are required.' });
    }
    // ... other validation ...

    try {
        // 1. Insert the payment record
        const { data: paymentData, error: paymentError } = await supabase
            .from('payments')
            .insert({
                admission_id,
                amount_paid: parseFloat(amount_paid),
                payment_date,
                method,
                receipt_number,
                notes,
                created_by: user_id
            })
            .select('id') // Select the ID of the newly created payment
            .single();

        if (paymentError) throw paymentError;

        // --- CRITICAL STEP: Update Installment Status ---
        // Call a database function to apply this payment to the installments
        const { error: updateError } = await supabase.rpc('apply_payment_to_installments', {
             p_payment_id: paymentData.id // Pass the new payment ID
        });

        if (updateError) {
             // Log this critical error, maybe attempt compensation or alert admin
             console.error(`CRITICAL: Failed to apply payment ${paymentData.id} to installments for admission ${admission_id}:`, updateError);
             // Decide how to respond. Maybe return success but with a warning?
             // Or return an error indicating partial failure. For now, let's return an error.
             return res.status(500).json({
                 error: 'Payment recorded, but failed to update installment status. Please check manually.',
                 details: updateError.message
             });
        }
        // --- End Critical Step ---

        res.status(201).json({ message: 'Payment recorded and applied successfully.', data: paymentData });

    } catch (error) {
        console.error('Error recording payment:', error);
        // ... (existing error handling) ...
        res.status(500).json({ error: 'An error occurred while recording the payment.' });
    }
};

/**
 * @description [NEW & CONSOLIDATED] Get details for the Accounts/Follow-up detail page.
 * Includes financial summary, ORIGINAL installments, ACTUAL payments, and follow-up log.
 * Replaces feeController.getInstallmentsForAdmission & parts of followUpController.getAdmissionFollowUpDetails
 */
exports.getAccountDetails = async (req, res) => {
  const { admissionId } = req.params;
  if (!admissionId) return res.status(400).json({ error: 'Admission ID is required.' });

  try {
    // Use Promise.all for parallel fetching
    const [
      financialsResult,
      installmentsResult,
      paymentsResult,
      followUpsResult,
      // Optional: Fetch courses if needed for detail view
      coursesResult
    ] = await Promise.all([
      // 1. Financial Summary
      supabase.from('v_admission_financial_summary')
              .select('student_name, student_phone_number, total_payable_amount, total_paid, remaining_due, branch') // Assuming branch is in the view or admissions table
              .eq('admission_id', admissionId)
              .maybeSingle(), // Use maybeSingle to handle not found gracefully
      // 2. Original Installment Plan (using v_installment_status for consistency)
      supabase.from('v_installment_status') // Use the status view
              .select('id, due_date, amount_due, status') // Select required fields
              .eq('admission_id', admissionId)
              .order('due_date', { ascending: true }),
      // 3. Actual Payment History
      supabase.from('payments')
              .select('id, payment_date, amount_paid, method, receipt_number, notes')
              .eq('admission_id', admissionId)
              .order('payment_date', { ascending: true }),
      // 4. Follow-up Log History
      supabase.from('follow_ups')
              .select('*, user:users ( username )')
              .eq('admission_id', admissionId)
              .order('follow_up_date', { ascending: false }),
      // 5. Courses (Optional - only if needed on this page)
      supabase.from('admission_courses')
              .select('course:courses ( name, price )') // Adjusted join syntax
              .eq('admission_id', admissionId)
    ]);

    // Check for critical errors (e.g., financials failed)
    if (financialsResult.error) throw financialsResult.error;
    if (installmentsResult.error) throw installmentsResult.error;
    // Log non-critical errors but continue
    if (paymentsResult.error) console.error("Error fetching payments:", paymentsResult.error);
    if (followUpsResult.error) console.error("Error fetching follow-ups:", followUpsResult.error);
    if (coursesResult.error) console.error("Error fetching courses:", coursesResult.error);


    const financials = financialsResult.data; // Can be null if not found
    if (!financials) {
       return res.status(404).json({ error: 'Admission financial summary not found.' });
    }

    // Format data for response
    const responseData = {
      name: financials.student_name,
      phones: [financials.student_phone_number],
      branch: financials.branch || "Faridabad_branch", // Use fetched branch or fallback
      total_fees: financials.total_payable_amount,
      total_paid: financials.total_paid,
      balance: financials.remaining_due,
      // Original Installment Plan
      installments: (installmentsResult.data || []).map(inst => ({
        id: inst.id,
        due_date: inst.due_date,
        amount: inst.amount_due, // Use amount_due from the status view
        status: inst.status
      })),
      // Actual Payments
      payments: paymentsResult.data || [],
      // Follow Up History
      follow_up_history: (followUpsResult.data || []).map(f => ({
        id: f.id,
        type: f.type,
        follow_up_date: f.follow_up_date,
        remarks: f.notes,
        followed_by: f.user ? f.user.username : 'System',
      })),
      // Courses
      courses: (coursesResult.data || []).map(c => c.course ? `${c.course.name}-${c.course.price}` : 'Unknown Course')
    };

    res.status(200).json(responseData);

  } catch (error) {
    console.error(`Error fetching account details for admission ${admissionId}:`, error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};


/**
 * @description [CONSOLIDATED] Get data needed to generate a receipt for a specific payment.
 * Replaces feeController.getReceiptDetails
 */
exports.getReceiptData = async (req, res) => {
    const { paymentId } = req.params;
    // ... (logic is largely the same as your original getReceiptData, ensure joins/selects match final schema) ...
    // Make sure to fetch admission details like gst_rate, is_gst_exempt for calculations.
    if (!paymentId) {
        return res.status(400).json({ error: 'Payment ID is required.' });
    }
     try {
        const { data: payment, error: payError } = await supabase
            .from('payments')
            .select(`
                *,
                admission:admissions (
                    id, date_of_admission, gst_rate, is_gst_exempt, total_payable_amount,
                    student:students ( name, phone_number, father_name, current_address ),
                    courses:admission_courses ( course:courses ( name, price ) )
                )
            `)
            .eq('id', paymentId)
            .single();

        if (payError) throw payError;
        if (!payment || !payment.admission) {
            return res.status(404).json({ error: 'Payment or associated admission not found.' });
        }

        // GST Calculation (same as before)
        // ...
         let gstBreakdown = { cgst: 0, sgst: 0, totalGst: 0, rate: 0 };
        let taxableAmount = payment.amount_paid;
         if (!payment.admission.is_gst_exempt && payment.admission.gst_rate > 0) {
            const rate = payment.admission.gst_rate / 100;
            taxableAmount = payment.amount_paid / (1 + rate);
            const totalGst = payment.amount_paid - taxableAmount;
            gstBreakdown = {
                cgst: totalGst / 2,
                sgst: totalGst / 2,
                totalGst: totalGst,
                rate: payment.admission.gst_rate
            };
        }


        // Structure receipt data (same as before)
        const receiptData = {
             receipt_number: payment.receipt_number || `TEMP-${payment.id.slice(0, 8)}`,
            payment_date: payment.payment_date,
            payment_method: payment.method,
            amount_paid: payment.amount_paid,
            amount_in_words: "Placeholder - Implement amount to words function", // TODO
            student_name: payment.admission.student?.name,
            father_name: payment.admission.student?.father_name, // Changed from student
            address: payment.admission.student?.current_address, // Changed from student
            admission_date: payment.admission.date_of_admission,
            courses: payment.admission.courses?.map(c => c.course?.name).join(', ') || 'N/A', // Safer mapping
            taxable_amount: taxableAmount,
            gst_summary: gstBreakdown,
            total_payable_admission: payment.admission.total_payable_amount,
            // TODO: Fetch previous balance by summing payments before this one's date
        };
        res.status(200).json(receiptData);
    } catch(error) {
        console.error(`Error fetching receipt data for payment ${paymentId}:`, error);
        // ... (error handling)
        res.status(500).json({ error: 'An unexpected error occurred.'});
    }
};

// --- Functions absorbed from feeController (potentially remove feeController) ---
// Note: getInstallmentsForAdmission is effectively replaced by getAccountDetails
// Note: getReceiptsForAdmission can be replaced by querying the 'payments' table directly if needed