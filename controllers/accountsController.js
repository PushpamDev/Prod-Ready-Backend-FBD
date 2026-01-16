// controllers/accountsController.js
const supabase = require('../db');

// --- Helper for new receipt number ---

/**
 * @description Get admissions list for the approval page or general accounts view.
 */
exports.getAdmissionsForAccounts = async (req, res) => {
  const { status = 'Approved', search = '' } = req.query; 

  try {
    let query = supabase
      .from('v_admission_financial_summary') 
      .select(
        'admission_number, admission_id, student_name, student_phone_number, created_at, total_payable_amount, total_paid, remaining_due, approval_status, status, base_amount'
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

    const formattedData = data.map((adm) => ({
      admission_number: adm.admission_number,
      id: adm.admission_id,
      name: adm.student_name || 'N/A',
      admission_date: adm.created_at,
      total_payable_amount: adm.total_payable_amount,
      total_paid: adm.total_paid,
      balance: adm.remaining_due,
      approval_status: adm.approval_status,
      status: adm.status,
      phone_number: adm.student_phone_number || 'N/A',
      base_amount: adm.base_amount
    }));

    res.status(200).json(formattedData);
  } catch (error) {
    console.error('Error fetching admissions for accounts:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Approve an admission.
 */
exports.approveAdmission = async (req, res) => {
  const { admissionId } = req.params;
  const { is_gst_exempt, gst_rate, finalAmountWithGST } = req.body;

  if (finalAmountWithGST === undefined || finalAmountWithGST < 0) {
    return res.status(400).json({ error: 'Final payable amount is required.' });
  }

  try {
    const { data: admissionData, error: fetchError } = await supabase
        .from('admissions')
        .select('final_payable_amount')
        .eq('id', admissionId)
        .single();

    if (fetchError || !admissionData) {
         return res.status(404).json({ error: 'Admission not found.' });
    }
    
    const taxableAmount = admissionData.final_payable_amount;
    const gstAmount = finalAmountWithGST - taxableAmount;

    const { data, error } = await supabase
      .from('admissions')
      .update({
        approval_status: 'Approved',
        rejection_reason: null,
        is_gst_exempt: is_gst_exempt,
        gst_rate: is_gst_exempt ? 0 : gst_rate,
        gst_amount: gstAmount,
        total_payable_amount: finalAmountWithGST
      })
      .eq('id', admissionId)
      .eq('approval_status', 'Pending') 
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
 * @description Reject an admission.
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
 * @description Record a payment for an admission.
 */
exports.recordPayment = async (req, res) => {
  const { admission_id, amount_paid, payment_date, method, notes } = req.body;
  // This must come from your Auth Middleware
  const user_id = req.user?.id; 

  if (!admission_id || !amount_paid || !payment_date || !method || !user_id) {
    return res.status(400).json({
      error: 'Missing required fields. Ensure you are logged in.',
    });
  }

  try {
    // 1. Generate receipt number
    const { data: receiptNumber, error: receiptError } =
      await supabase.rpc('generate_receipt_number');

    if (receiptError || !receiptNumber) {
      throw new Error('Failed to generate receipt number');
    }

    // 2. Insert payment with the logged-in user's ID
    const { data: paymentData, error: paymentError } = await supabase
      .from('payments')
      .insert({
        admission_id,
        amount_paid: parseFloat(amount_paid),
        payment_date,
        method,
        receipt_number: receiptNumber,
        notes,
        created_by: user_id, // This UUID links to your users/profiles table
      })
      .select('id')
      .single();

    if (paymentError) throw paymentError;

    // 3. Apply payment to installments (RPC)
    const { error: updateError } = await supabase.rpc(
      'apply_payment_to_installments',
      { p_payment_id: paymentData.id }
    );

    if (updateError) {
      console.error('Installment update failed:', updateError);
      return res.status(500).json({ error: 'Payment recorded, but installment update failed.' });
    }

    res.status(201).json({
      message: 'Payment recorded successfully.',
      payment_id: paymentData.id,
      receipt_number: receiptNumber,
    });

  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: 'An error occurred while recording the payment.' });
  }
};
/**
 * @description Get details for the Accounts detail page.
 * Manually joins with public.users to show which staff member recorded the payment.
 */
exports.getAccountDetails = async (req, res) => {
  const { admissionId } = req.params;
  if (!admissionId) return res.status(400).json({ error: 'Admission ID is required.' });

  try {
    const [
      financialsResult,
      installmentsResult,
      paymentsResult,
      coursesResult
    ] = await Promise.all([
      supabase.from('v_admission_financial_summary')
              .select('student_id, student_name, admission_number, student_phone_number, branch') 
              .eq('admission_id', admissionId)
              .single(),
      supabase.from('v_installment_status') 
              .select('id, due_date, amount_due, status') 
              .eq('admission_id', admissionId)
              .order('due_date', { ascending: true }),
      supabase.from('payments')
              .select('id, payment_date, amount_paid, method, receipt_number, notes, created_by')
              .eq('admission_id', admissionId)
              .order('payment_date', { ascending: true }),
      supabase.from('admission_courses')
              .select('courses ( name )')
              .eq('admission_id', admissionId)
    ]);

    if (financialsResult.error) throw financialsResult.error;
    if (installmentsResult.error) throw installmentsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    if (coursesResult.error) throw coursesResult.error;

    // --- STAFF LOOKUP LOGIC ---
    const rawPayments = paymentsResult.data || [];
    let paymentsWithStaff = [];

    if (rawPayments.length > 0) {
      // 1. Get unique UUIDs of staff from the payments
      const staffIds = [...new Set(rawPayments.map(p => p.created_by).filter(Boolean))];

      // 2. Fetch usernames from the 'users' table
      const { data: userData, error: userError } = await supabase
        .from('users') 
        .select('id, username')
        .in('id', staffIds);

      if (userError) {
        console.warn("Could not fetch staff usernames:", userError);
      }

      // 3. Create a mapping of { id: username }
      const staffMap = {};
      (userData || []).forEach(u => {
        staffMap[u.id] = u.username;
      });

      // 4. Combine payment data with the username
      paymentsWithStaff = rawPayments.map(p => ({
        ...p,
        collected_by: staffMap[p.created_by] || 'System' // This matches the key in your Dialog UI
      }));
    }

    const financials = financialsResult.data;
    const installments = installmentsResult.data || [];

    const calculatedTotalFees = installments.reduce((sum, inst) => sum + Number(inst.amount_due), 0);
    const totalPaid = paymentsWithStaff.reduce((sum, p) => sum + Number(p.amount_paid), 0);

    const responseData = {
      student_id: financials.student_id,
      admission_number: financials.admission_number,
      name: financials.student_name,
      phones: [financials.student_phone_number],
      branch: financials.branch,
      total_fees: calculatedTotalFees,
      total_paid: totalPaid,
      balance: calculatedTotalFees - totalPaid,
      installments: installments.map(inst => ({
        id: inst.id,
        due_date: inst.due_date,
        amount: inst.amount_due, 
        status: inst.status
      })),
      payments: paymentsWithStaff, // Now contains 'collected_by' string
      courses: (coursesResult.data || []).map(c => c.courses.name)
    };

    res.status(200).json(responseData);

  } catch (error) {
    console.error(`Error fetching account details:`, error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};
/**
 * @description Get data needed to generate a receipt for a specific payment.
 */
exports.getReceiptData = async (req, res) => {
    const { paymentId } = req.params;
    if (!paymentId) {
        return res.status(400).json({ error: 'Payment ID is required.' });
    }
     try {
        const { data: payment, error: payError } = await supabase
            .from('payments')
            .select(`
                *,
                admissions (
                    id, 
                    date_of_admission, 
                    gst_rate, 
                    is_gst_exempt, 
                    total_payable_amount,
                    batch_preference,
                    father_name,
                    current_address,
                    students ( 
                        name, 
                        phone_number, 
                        admission_number,
                        batch_students ( batches ( name ) ) 
                    ),
                    admission_courses ( courses ( name, price ) )
                )
            `)
            .eq('id', paymentId)
            .single();

        if (payError) {
            console.error("Supabase query failed:", payError);
            throw payError;
        }
        
        const admissionData = payment.admissions;
        if (!payment || !admissionData) {
            return res.status(404).json({ error: 'Payment or associated admission not found.' });
        }
        
        const studentData = admissionData.students;
        const coursesData = admissionData.admission_courses;

        const batchData = studentData?.batch_students || [];
        const actualBatches = batchData.map(bs => bs.batches?.name).filter(Boolean);
        const batchString = actualBatches.length > 0 ? actualBatches.join(', ') : 'Not Allotted';

        let gstBreakdown = { cgst: 0, sgst: 0, totalGst: 0, rate: 0 };
        let taxableAmount = payment.amount_paid;
         if (!admissionData.is_gst_exempt && admissionData.gst_rate > 0) {
            const rate = admissionData.gst_rate / 100;
            taxableAmount = payment.amount_paid / (1 + rate);
            const totalGst = payment.amount_paid - taxableAmount;
            gstBreakdown = {
                cgst: totalGst / 2,
                sgst: totalGst / 2,
                totalGst: totalGst,
                rate: admissionData.gst_rate
            };
        }

        const receiptData = {
             receipt_number: payment.receipt_number,
            payment_date: payment.payment_date,
            payment_method: payment.method,
            amount_paid: payment.amount_paid,
            amount_in_words: "Placeholder - Implement amount to words function",
            
            notes: payment.notes, 
            
            admission_id: admissionData.id, 
            student_name: studentData?.name,
            student_phone: studentData?.phone_number,
            father_name: admissionData.father_name,
            address: admissionData.current_address,
            id_card_no: studentData?.admission_number, 
            admission_batch: batchString,
            
            admission_date: admissionData.date_of_admission,
            courses: coursesData?.map(c => c.courses?.name).join(', ') || 'N/A',
            
            taxable_amount: taxableAmount,
            gst_summary: gstBreakdown,
            total_payable_admission: admissionData.total_payable_amount,
        };
        res.status(200).json(receiptData);
    } catch(error) {
        console.error(`Error fetching receipt data for payment ${paymentId}:`, error);
        res.status(500).json({ error: 'An unexpected server error occurred.', details: error.message });
    }
};