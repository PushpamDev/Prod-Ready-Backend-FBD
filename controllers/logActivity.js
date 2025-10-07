const supabase = require('../db.js');

/**
 * Logs an activity to the database.
 * @param {object} req - The Express request object, containing req.user from the auth middleware.
 * @param {string} action - The action performed (e.g., 'Created', 'Updated', 'Deleted').
 * @param {string} item - A description of the item that was affected (e.g., 'Faculty "John Doe"').
 * @param {string} type - The category or type of the item (e.g., 'faculty', 'batch').
 */
async function logActivity(req, action, item, type) {
  try {
    // 1. Get the user ID from req.user provided by your auth middleware.
    //    Using optional chaining and a fallback for safety.
    const userId = req.user?.id;

    // If for some reason there is no user on the request, we should not log.
    if (!userId) {
      console.error('Error logging activity: User ID not found on request object. Was auth middleware used?');
      return;
    }

    // 2. Insert the activity with the real user ID.
    const { error } = await supabase
      .from('activities')
      .insert([{ 
        action, 
        item, 
        type, 
        user_id: userId 
      }]);

    if (error) {
      // Re-throw the error to be caught by the calling function's catch block if needed.
      throw error;
    }
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

module.exports = { logActivity };