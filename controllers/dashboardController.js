// controllers/dashboardController.js
const supabase = require('../db');

exports.getDashboardData = async (req, res) => {
  const { search = '' } = req.query;

  try {
    // 1. Fetch Admissions and their Installments simultaneously
    const [admissionsRes, installmentsRes] = await Promise.all([
      supabase.from('v_admission_financial_summary').select('*').order('created_at', { ascending: false }),
      supabase.from('installments').select('admission_id, amount')
    ]);

    if (admissionsRes.error) throw admissionsRes.error;
    if (installmentsRes.error) throw installmentsRes.error;

    let admissions = admissionsRes.data;
    const allInstallments = installmentsRes.data;

    // 2. Map installments to their admissions to calculate "True Total"
    const installmentTotalsMap = allInstallments.reduce((acc, inst) => {
      acc[inst.admission_id] = (acc[inst.admission_id] || 0) + Number(inst.amount);
      return acc;
    }, {});

    // 3. Synchronize data for the list and metrics
    const synchronizedAdmissions = admissions.map(adm => {
      const trueTotal = installmentTotalsMap[adm.admission_id] || adm.total_payable_amount;
      return {
        ...adm,
        total_payable_amount: trueTotal,
        remaining_due: trueTotal - adm.total_paid
      };
    });

    // 4. Filtering for search (if applicable)
    const finalAdmissions = search 
      ? synchronizedAdmissions.filter(a => 
          a.student_name.toLowerCase().includes(search.toLowerCase()) || 
          a.student_phone_number.includes(search))
      : synchronizedAdmissions;

    // 5. Calculate Metrics using the Synchronized Data
    const totalCollected = finalAdmissions.reduce((acc, adm) => acc + Number(adm.total_paid), 0);
    const totalOutstanding = finalAdmissions.reduce((acc, adm) => acc + Number(adm.remaining_due), 0);
    
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const admissionsThisMonth = finalAdmissions.filter(adm => {
        const admDate = new Date(adm.created_at);
        return admDate.getMonth() === thisMonth && admDate.getFullYear() === thisYear;
    });

    res.status(200).json({
      metrics: {
        totalAdmissions: finalAdmissions.length,
        admissionsThisMonth: admissionsThisMonth.length,
        totalCollected,
        revenueCollectedThisMonth: admissionsThisMonth.reduce((acc, adm) => acc + Number(adm.total_paid), 0),
        totalOutstanding,
        overdueCount: finalAdmissions.filter(adm => adm.status === 'Overdue').length
      },
      admissions: finalAdmissions,
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};