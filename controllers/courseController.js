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
 * @description Get all courses, including a count of associated books, using Supabase client.
 */
exports.getAllCourses = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select('*, course_books(count)'); // Supabase can count related records

    if (error) throw error;

    const formattedData = data.map(course => ({
        ...course,
        book_count: course.course_books[0]?.count || 0, // Clean up the count structure
        course_books: undefined, // Remove the verbose object
        price_formatted: formatToINR(course.price)
    }));

    res.status(200).json(formattedData);
  } catch (error) {
    console.error('Error fetching all courses:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Get a single course by ID, including its associated books, using Supabase client.
 */
exports.getCourseById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
        .from('courses')
        .select('*, books(*)') // Through the junction table, select all columns from related books
        .eq('id', id)
        .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Course not found' });

    const course = {
        ...data,
        price_formatted: formatToINR(data.price)
    };
    res.status(200).json(course);
  } catch (error)    {
    console.error(`Error fetching course ${id}:`, error);
     if (error.code === 'PGRST116') { // Supabase code for "not found" with .single()
         return res.status(404).json({ error: 'Course not found' });
    }
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Create a new course and link its books using a database function (RPC).
 */
exports.createCourse = async (req, res) => {
  const { name, price, book_ids } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'A non-empty name is required.' });
  }
  if (price === undefined || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
    return res.status(400).json({ error: 'A valid, non-negative price is required.' });
  }
  if (book_ids && !Array.isArray(book_ids)) {
    return res.status(400).json({ error: 'book_ids must be an array of UUIDs.' });
  }

  try {
    const { data, error } = await supabase.rpc('create_course_with_books', {
        p_name: name.trim(),
        p_price: price,
        p_book_ids: book_ids || []
    });

    if (error) throw error;

    res.status(201).json({ id: data, name: name.trim(), price: price });
  } catch (error) {
    console.error('Error creating course:', error);
    if (error.details?.includes('already exists')) { // Check for unique violation
        return res.status(409).json({ error: 'A course with this name already exists.' });
    }
    if (error.message?.includes('foreign key constraint')) { // Check for invalid book ID
        return res.status(400).json({ error: 'One or more of the provided book IDs are invalid.' });
    }
    res.status(500).json({ error: 'An error occurred while creating the course.' });
  }
};

/**
 * @description Update an existing course and its book associations using a database function (RPC).
 */
exports.updateCourse = async (req, res) => {
  const { id } = req.params;
  const { name, price, book_ids } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'A non-empty name is required.' });
  }
  if (price === undefined || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
    return res.status(400).json({ error: 'A valid, non-negative price is required.' });
  }
   if (book_ids && !Array.isArray(book_ids)) {
    return res.status(400).json({ error: 'book_ids must be an array of UUIDs.' });
  }

  try {
    const { error } = await supabase.rpc('update_course_with_books', {
        p_course_id: id,
        p_name: name.trim(),
        p_price: price,
        p_book_ids: book_ids || []
    });

    if (error) throw error;

    res.status(200).json({ id: id, name: name.trim(), price: price });
  } catch (error) {
    console.error(`Error updating course ${id}:`, error);
     if (error.details?.includes('already exists')) {
        return res.status(409).json({ error: 'A course with this name already exists.' });
    }
    if (error.message?.includes('foreign key constraint')) {
        return res.status(400).json({ error: 'One or more of the provided book IDs are invalid.' });
    }
    res.status(500).json({ error: 'An error occurred while updating the course.' });
  }
};

/**
 * @description Delete a course using Supabase client.
 */
exports.deleteCourse = async (req, res) => {
  const { id } = req.params;
  try {
    const { error, count } = await supabase
        .from('courses')
        .delete({ count: 'exact' })
        .eq('id', id);

    if (error) throw error;
    if (count === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting course ${id}:`, error);
    if (error.code === '23503') { // Foreign key violation
        return res.status(409).json({ error: 'Cannot delete this course as it is assigned to one or more admissions.' });
    }
    res.status(500).json({ error: 'An error occurred while deleting the course.' });
  }
};

