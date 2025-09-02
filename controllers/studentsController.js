const supabase = require('../supabaseClient');

const getAllStudents = async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('*');

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json(data);
};

const createStudent = async (req, res) => {
  const { name, admission_number, phone_number } = req.body;

  const { data, error } = await supabase
    .from('students')
    .insert([{ name, admission_number, phone_number }])
    .select();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(data);
};

const updateStudent = async (req, res) => {
  const { id } = req.params;
  const { name, admission_number, phone_number } = req.body;

  const { data, error } = await supabase
    .from('students')
    .update({ name, admission_number, phone_number })
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
  deleteStudent,
};