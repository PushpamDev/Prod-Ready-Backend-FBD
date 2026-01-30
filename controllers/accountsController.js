// controllers/accountsController.js
const supabase = require('../db');

/**
 * @description Get admissions list for the approval page or general accounts view.
 * Scoped by location_id with a global override for 'pushpam'.
 */
exports.getAdmissionsForAccounts = async (req, res) => {
  const { status = 'Approved', search = '' } = req.query; 
  const locationId = req.locationId;
  const isPushpam = req.user?.username === 'pushpam';

  try {
    let query = supabase
      .from('v_admission_financial_summary') 
      .select('admission_number, admission_id, student_name, student_phone_number, created_at, total_payable_amount, total_paid, remaining_due, approval_status, status, base_amount, location_id');

    // ✅ Branch Security: Apply location filter unless user is Pushpam
    if (!isPushpam) {
      if (!locationId) return res.status(401).json({ error: 'Location context missing.' });
      query = query.eq('location_id', locationId);
    }

    if (status && status !== 'All') {
      query = query.eq('approval_status', status);
    }

    if (search) {
      query = query.or(`student_name.ilike.%${search}%,student_phone_number.ilike.%${search}%,admission_number.ilike.%${search}%`);
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
 * Helper: Converts numeric amount to Indian Rupee Words
 */
const numToWords = (n) => {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if ((n = n.toString()).length > 9) return 'Amount too large';
  let nArray = ('000000000' + n).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!nArray) return '';
  let str = '';
  str += (nArray[1] != 0) ? (b[nArray[1][0]] || a[nArray[1]]) + (b[nArray[1][0]] ? ' ' + a[nArray[1]] : '') + 'Crore ' : '';
  str += (nArray[2] != 0) ? (b[nArray[2][0]] || a[nArray[2]]) + (b[nArray[2][0]] ? ' ' + a[nArray[2]] : '') + 'Lakh ' : '';
  str += (nArray[3] != 0) ? (b[nArray[3][0]] || a[nArray[3]]) + (b[nArray[3][0]] ? ' ' + a[nArray[3]] : '') + 'Thousand ' : '';
  str += (nArray[4] != 0) ? a[nArray[4]] + 'Hundred ' : '';
  str += (nArray[5] != 0) ? ((str != '') ? 'and ' : '') + (b[nArray[5][0]] || a[nArray[5]]) + (b[nArray[5][0]] ? ' ' + a[nArray[5]] : '') : '';
  return str.trim() + ' Rupees Only';
};

/**
 * @description Record payment and sync across payments and receipts tables.
 * [UPDATED] Robust branch validation and automated installment balancing.
 */
exports.recordPayment = async (req, res) => {
  const { admission_id, amount_paid, payment_date, method, notes } = req.body;
  const user_id = req.user?.id;
  const locationId = req.locationId; // Extracted from middleware
  const username = req.user?.username;

  if (!admission_id || !amount_paid || !payment_date || !method || !user_id) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    // 1. Verify branch before recording payment
    const { data: adm, error: admError } = await supabase
      .from('admissions')
      .select('location_id')
      .eq('id', admission_id)
      .single();

    if (admError || !adm) return res.status(404).json({ error: 'Admission not found.' });

    // ✅ Security: Pushpam override for global branch access
    if (username !== 'pushpam' && Number(adm.location_id) !== Number(locationId)) {
      return res.status(403).json({ error: 'Unauthorized: Cannot record payment for another branch.' });
    }

    // 2. Generate unique receipt number via database sequence
    const { data: receiptNumber, error: receiptError } = await supabase.rpc('generate_receipt_number');
    if (receiptError || !receiptNumber) throw new Error('Failed to generate receipt number');

    // 3. Insert primary payment record
    const { data: paymentData, error: paymentError } = await supabase
      .from('payments')
      .insert({
        admission_id,
        amount_paid: parseFloat(amount_paid),
        payment_date,
        method,
        receipt_number: receiptNumber,
        notes,
        created_by: user_id,
      })
      .select('id').single();

    if (paymentError) throw paymentError;

    // 4. Trigger FIFO Installment Balancing
    // This RPC handles the 'Paid' status logic on the backend
    const { error: rpcError } = await supabase.rpc('apply_payment_to_installments', { 
      p_payment_id: paymentData.id 
    });
    
    if (rpcError) console.warn("Installment balancing warning:", rpcError.message);

    // 5. Sync with Receipts table for historical auditing
    await supabase.from('receipts').insert({
        admission_id,
        receipt_number: receiptNumber,
        amount_paid: parseFloat(amount_paid),
        payment_date,
        payment_method: method,
        generated_by: user_id,
        location_id: adm.location_id
    });

    res.status(201).json({ 
      message: 'Payment recorded successfully.', 
      payment_id: paymentData.id, 
      receipt_number: receiptNumber 
    });
  } catch (error) {
    console.error('Critical Payment Error:', error);
    res.status(500).json({ error: 'An error occurred while recording the payment.' });
  }
};
/**
 * @description Get details for the Accounts detail page.
 * [UPDATED] Validates UUID syntax and enforces branch-level security.
 */
exports.getAccountDetails = async (req, res) => {
  const { admissionId } = req.params;
  const locationId = req.locationId; // From Auth Middleware
  const isPushpam = req.user?.username === 'pushpam';

  // ✅ 1. Validate UUID syntax to prevent "invalid input syntax for type uuid" error
  if (!admissionId || admissionId === 'undefined') {
    return res.status(400).json({ 
      error: 'Invalid Admission ID.', 
      details: 'The ID received was undefined or missing. Please refresh the page and try again.' 
    });
  }

  try {
    const [
      financialsResult,
      installmentsResult,
      paymentsResult,
      coursesResult
    ] = await Promise.all([
      // Added location_id to the select for security check
      supabase.from('v_admission_financial_summary')
              .select('student_id, student_name, admission_number, student_phone_number, branch, location_id') 
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

    // Handle initial database errors
    if (financialsResult.error) throw financialsResult.error;
    if (installmentsResult.error) throw installmentsResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    if (coursesResult.error) throw coursesResult.error;

    const financials = financialsResult.data;

    // ✅ 2. Branch Security Gate: 
    // Only allow access if the branch matches OR user is pushpam
    if (!isPushpam && Number(financials.location_id) !== Number(locationId)) {
      return res.status(403).json({ error: 'Access denied: This record belongs to another branch.' });
    }

    // --- STAFF LOOKUP LOGIC ---
    const rawPayments = paymentsResult.data || [];
    let paymentsWithStaff = [];

    if (rawPayments.length > 0) {
      const staffIds = [...new Set(rawPayments.map(p => p.created_by).filter(Boolean))];

      const { data: userData, error: userError } = await supabase
        .from('users') 
        .select('id, username')
        .in('id', staffIds);

      if (userError) console.warn("Could not fetch staff usernames:", userError);

      const staffMap = {};
      (userData || []).forEach(u => { staffMap[u.id] = u.username; });

      paymentsWithStaff = rawPayments.map(p => ({
        ...p,
        collected_by: staffMap[p.created_by] || 'System'
      }));
    }

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
      payments: paymentsWithStaff,
      courses: (coursesResult.data || []).map(c => c.courses?.name).filter(Boolean)
    };

    res.status(200).json(responseData);

  } catch (error) {
    console.error(`Error fetching account details:`, error);
    // Specifically catch Postgres UUID type errors to give better feedback
    if (error.code === '22P02') {
      return res.status(400).json({ error: 'Invalid ID format.', details: 'The system expected a UUID but received something else.' });
    }
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
};
/**
 * @description Get comprehensive data for receipt generation.
 * Restored to include full student profile and financial breakdown.
 */
exports.getReceiptData = async (req, res) => {
  const { paymentId } = req.params;
  const locationId = req.locationId; 
  const isPushpam = req.user?.username === 'pushpam';

  if (!paymentId) return res.status(400).json({ error: 'Payment ID is required.' });

  try {
    const { data: payment, error: payError } = await supabase
      .from('payments')
      .select(`
        *,
        admissions!payments_admission_id_fkey (
          id, 
          date_of_admission, 
          gst_rate, 
          is_gst_exempt, 
          total_payable_amount,
          father_name, 
          current_address, 
          location_id,
          students ( 
            name, 
            phone_number, 
            admission_number,
            batch_students ( batches ( name ) )
          ),
          admission_courses ( courses ( name, price ) ),
          installments!installments_admission_id_fkey ( id, due_date, amount, status )
        )
      `)
      .eq('id', paymentId)
      .maybeSingle();

    if (payError || !payment || !payment.admissions) {
      console.error("Receipt Query Error:", payError);
      return res.status(404).json({ error: 'Payment or associated admission not found.' });
    }

    const admissionData = payment.admissions;
    const studentData = admissionData.students;

    // --- BRANCH SECURITY GATE ---
    if (!isPushpam && Number(admissionData.location_id) !== Number(locationId)) {
      return res.status(403).json({ error: 'Access denied: Branch mismatch.' });
    }

    // --- AGGREGATION & LOGIC ---
    
    // 1. Prediction Logic (Next Pending Installment)
    const nextInst = (admissionData.installments || [])
      .filter(i => i.status !== 'Paid')
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];

    // 2. Batch Formatting
    const batchString = studentData?.batch_students
      ?.map(bs => bs.batches?.name)
      .filter(Boolean)
      .join(', ') || 'Not Allotted';

    // 3. GST & Taxable Amount Calculation
    let gstBreakdown = { cgst: 0, sgst: 0, totalGst: 0, rate: admissionData.gst_rate || 0 };
    let taxableAmount = Number(payment.amount_paid);
    
    if (!admissionData.is_gst_exempt && admissionData.gst_rate > 0) {
      const rateMultiplier = admissionData.gst_rate / 100;
      taxableAmount = payment.amount_paid / (1 + rateMultiplier);
      const totalGst = payment.amount_paid - taxableAmount;
      gstBreakdown = { 
        cgst: totalGst / 2, 
        sgst: totalGst / 2, 
        totalGst, 
        rate: admissionData.gst_rate 
      };
    }

    // --- FINAL RESPONSE MAPPING ---
    const receiptData = {
      receipt_number: payment.receipt_number,
      payment_date: payment.payment_date,
      payment_method: payment.method,
      amount_paid: payment.amount_paid,
      amount_in_words: numToWords(Math.floor(payment.amount_paid)),
      notes: payment.notes,
      admission_id: admissionData.id,
      student_name: studentData?.name,
      student_phone: studentData?.phone_number,
      id_card_no: studentData?.admission_number,
      admission_batch: batchString,
      admission_date: admissionData.date_of_admission,
      father_name: admissionData.father_name || 'N/A',
      address: admissionData.current_address || 'N/A',
      courses: admissionData.admission_courses?.map(c => c.courses?.name).join(', ') || 'N/A',
      taxable_amount: taxableAmount.toFixed(2),
      gst_summary: gstBreakdown,
      total_payable_admission: admissionData.total_payable_amount,
      
      // Prediction object retained for future-proofing
      prediction: {
        next_due_date: nextInst ? nextInst.due_date : null,
        next_due_amount: nextInst ? nextInst.amount : 0,
        is_fully_paid: !nextInst
      }
    };

    res.status(200).json(receiptData);
  } catch (error) {
    console.error(`Error fetching receipt data:`, error);
    res.status(500).json({ error: 'Server error occurred.', details: error.message });
  }
};