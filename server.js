require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");

// --- Your Route Imports ---
const facultyRoutes = require("./routes/faculty");
const availabilityRoutes = require("./routes/availability");
const batchesRoutes = require("./routes/batches");
const skillsRoutes = require("./routes/skills");
const freeSlotsRoutes = require("./routes/freeSlots");
const activityRoutes = require("./routes/activity");
const userRoutes = require("./routes/user");
const studentRoutes = require("./routes/students");
const suggestionRoutes = require("./routes/suggestion");
const attendanceRoutes = require('./routes/attendanceRoutes');
const viewBatchRoutes = require("./routes/viewBatch");
const announcementRoutes = require("./routes/announcements");
const ticketRoutes = require("./routes/ticketManagementRoutes");
const chatRoutes = require("./routes/chatRoutes");
const substitutionRoutes = require("./routes/substitution");

const app = express();
const PORT = process.env.PORT || 3001;
const auth = require("./middleware/auth");

app.use(cors());
app.use(express.json());

// --- 1. API ROUTES ---
// (All routes are now protected by `auth` except for `userRoutes`)

app.use("/api/faculty", auth, facultyRoutes);
app.use("/api/availability", auth, availabilityRoutes);
app.use("/api/batches", auth, batchesRoutes);
app.use("/api/view-batch", auth, viewBatchRoutes); // --- MODIFIED ---
app.use("/api/skills", auth, skillsRoutes); // --- MODIFIED ---
app.use("/api/free-slots", auth, freeSlotsRoutes); // --- MODIFIED ---
app.use("/api/activities", auth, activityRoutes); // --- MODIFIED ---

// --- NO CHANGE ---
// `userRoutes` is left public because it contains the `/login` route.
// We secured all the *other* user routes inside the `userRoutes.js` file.
app.use("/api/users", userRoutes); 

app.use("/api/students", auth, studentRoutes); // --- MODIFIED ---
app.use("/api/suggestions", auth, suggestionRoutes); // --- MODIFIED ---
app.use('/api/attendance', auth, attendanceRoutes); // --- MODIFIED ---
app.use("/api/announcements", auth, announcementRoutes); // --- MODIFIED ---
app.use("/api/tickets", auth, ticketRoutes); // --- MODIFIED ---
app.use("/api/chat", auth, chatRoutes); // --- MODIFIED ---
app.use("/api/substitution", auth, substitutionRoutes);

// --- 2. SERVE STATIC FRONTEND FILES (for Production) ---
// (Your existing code looks correct)
const frontendBuildPath = path.join(__dirname, '../Prod-Ready-Frontend-FBD-main/dist/spa');
app.use(express.static(frontendBuildPath));


// --- 3. SPA CATCH-ALL ROUTE (for Production) ---
// (Your existing code looks correct)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});


// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});