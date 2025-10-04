const supabase = require('../db');

// --- CORRECTED FUNCTION ---
const getAllStudents = async (req, res) => {
  try {
    const allStudents = [];
    const pageSize = 1000; // Supabase's default/max limit per request
    let page = 0;
    let moreDataAvailable = true;
    let totalCount = 0;

    while (moreDataAvailable) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      // We only need to get the count on the first request (page === 0)
      const shouldFetchCount = page === 0;

      const { data, error, count } = await supabase
        .from('students')
        .select('*', { count: shouldFetchCount ? 'exact' : 'estimated' })
        .range(from, to);

      if (error) {
        throw error;
      }
      
      // If we got data, add it to our results array
      if (data) {
        allStudents.push(...data);
      }
      
      // On the first loop, store the total count
      if (shouldFetchCount && count !== null) {
        totalCount = count;
      }

      // If the number of records returned is less than the page size,
      // it means we've reached the last page.
      if (!data || data.length < pageSize) {
        moreDataAvailable = false;
      }

      page++;
    }

    // Send the complete list and the total count
    res.status(200).json({ students: allStudents, count: totalCount });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createStudent = async (req, res) => {
  const { name, admission_number, phone_number, remarks } = req.body;

  const { data, error } = await supabase
    .from('students')
    .insert([{ name, admission_number, phone_number, remarks }])
    .select();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(data);
};

const updateStudent = async (req, res) => {
  const { id } = req.params;
  const { name, admission_number, phone_number, remarks } = req.body;

  const { data, error } = await supabase
    .from('students')
    .update({ name, admission_number, phone_number, remarks })
    .eq('id', id)
    .select();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json(data);
};

const deleteStudent = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('students')
    .delete()
    .eq('id', id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(204).send();
};

module.exports = {
  getAllStudents,
  createStudent,
  updateStudent,
  deleteStudent
};