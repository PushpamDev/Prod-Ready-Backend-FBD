// controllers/accountsController.js
const supabase = require('../db');

/**
 * @description Get admissions list for the approval page or general accounts view.
 * Filtered by the staff's locationId for security and clarity.
 */
exports.getAdmissionsForAccounts = async (req, res) => {
  const { status = 'Approved', search = '' } = req.query; 
  const locationId = req.locationId; // Extracted from Auth Middleware

  if (!locationId) {
    return res.status(401).json({ error: 'Location context missing. Please re-login.' });
  }

  try {
    let query = supabase
      .from('v_admission_financial_summary') 
      .select(
        'admission_number, admission_id, student_name, student_phone_number, created_at, total_payable_amount, total_paid, remaining_due, approval_status, status, base_amount, location_id'
      )
      .eq('location_id', locationId); // <--- CRITICAL FILTER: Scopes view to branch

    // Apply Approval Status filter
    if (status && status !== 'All') {
      query = query.eq('approval_status', status);
    }

    // Apply Search filter
    if (search) {
      query = query.or(
        `student_name.ilike.%${search}%,student_phone_number.ilike.%${search}%,admission_number.ilike.%${search}%`
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
 * UPDATED: Record payment and sync with receipts table
 */
exports.recordPayment = async (req, res) => {
  const { admission_id, amount_paid, payment_date, method, notes } = req.body;
  const user_id = req.user?.id;

  if (!admission_id || !amount_paid || !payment_date || !method || !user_id) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const { data: receiptNumber, error: receiptError } = await supabase.rpc('generate_receipt_number');
    if (receiptError || !receiptNumber) throw new Error('Failed to generate receipt number');

    // 1. Insert into payments table
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

    // 2. Apply to installments via RPC
    const { error: updateError } = await supabase.rpc('apply_payment_to_installments', { 
      p_payment_id: paymentData.id 
    });

    if (updateError) console.error('Installment update failed:', updateError);

    // 3. NEW: Sync with receipts table so it's no longer empty
    await supabase.from('receipts').insert({
        admission_id,
        receipt_number: receiptNumber,
        amount_paid: parseFloat(amount_paid),
        payment_date,
        payment_method: method,
        generated_by: user_id
    });

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
 * UPDATED: Get data for receipt with prediction logic
 */
exports.getReceiptData = async (req, res) => {
  const { paymentId } = req.params;
  if (!paymentId) return res.status(400).json({ error: 'Payment ID is required.' });

  try {
    const { data: payment, error: payError } = await supabase
      .from('payments')
      .select(`
        *,
        admissions (
          id, date_of_admission, gst_rate, is_gst_exempt, total_payable_amount,
          father_name, current_address,
          students ( name, phone_number, admission_number, batch_students ( batches ( name ) ) ),
          admission_courses ( courses ( name, price ) ),
          installments ( id, due_date, amount, status )
        )
      `)
      .eq('id', paymentId)
      .single();

    if (payError || !payment || !payment.admissions) {
      return res.status(404).json({ error: 'Payment or associated admission not found.' });
    }

    const admissionData = payment.admissions;
    const studentData = admissionData.students;

    // --- PREDICTION LOGIC ---
    // Find the next upcoming installment that isn't paid
    const nextInst = (admissionData.installments || [])
      .filter(i => i.status !== 'Paid')
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];

    // Batch Formatting
    const batchString = studentData?.batch_students?.map(bs => bs.batches?.name).filter(Boolean).join(', ') || 'Not Allotted';

    // GST logic
    let gstBreakdown = { cgst: 0, sgst: 0, totalGst: 0, rate: admissionData.gst_rate || 0 };
    let taxableAmount = Number(payment.amount_paid);
    
    if (!admissionData.is_gst_exempt && admissionData.gst_rate > 0) {
      const rate = admissionData.gst_rate / 100;
      taxableAmount = payment.amount_paid / (1 + rate);
      const totalGst = payment.amount_paid - taxableAmount;
      gstBreakdown = { cgst: totalGst / 2, sgst: totalGst / 2, totalGst, rate: admissionData.gst_rate };
    }

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
      courses: admissionData.admission_courses?.map(c => c.courses?.name).join(', ') || 'N/A',
      taxable_amount: taxableAmount.toFixed(2),
      gst_summary: gstBreakdown,
      total_payable_admission: admissionData.total_payable_amount,
      
      // Predicted Next Payment Info
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