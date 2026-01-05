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
const courseRoutes = require("./routes/courseRoutes");
const admissionRoutes = require("./routes/admissionRoutes");
const followUpRoutes = require("./routes/followUpRoutes");
const certificateRoutes = require("./routes/certificateRoutes");
const dashboardRoutes = require('./routes/dashboardRoutes');
const accountsRoutes = require('./routes/accountsRoutes');
const substitutionRoutes = require("./routes/substitution");
const intakeRoutes = require('./routes/intake');
const admissionUndertakingRoutes = require('./routes/admissionUndertaking');
const batchAllotmentRoutes = require('./routes/batchAllotmentRoutes');
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
app.use("/api/view-batch", viewBatchRoutes);
app.use("/api/skills", skillsRoutes);
app.use("/api/free-slots", freeSlotsRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/users", userRoutes);
app.use("/api/students", auth, studentRoutes);
app.use("/api/suggestions", suggestionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/admissions", admissionRoutes);
app.use("/api/dashboard", auth, dashboardRoutes);
app.use("/api/accounts", auth, accountsRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/follow-ups", auth, followUpRoutes);
app.use("/api/substitutions", auth, substitutionRoutes);
app.use('/api/intakes', intakeRoutes);
app.use('/', admissionUndertakingRoutes);
app.use('/api/batch-allotment', auth, batchAllotmentRoutes);

// --- 2. SERVE STATIC FRONTEND FILES (for Production) ---
const frontendBuildPath = path.join(__dirname, '../Prod-Ready-Frontend-FBD-main/dist/spa');
app.use(express.static(frontendBuildPath));


// --- 3. SPA CATCH-ALL ROUTE (for Production) ---
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});


// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});