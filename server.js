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
app.use("/api/faculty", facultyRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/batches", auth, batchesRoutes);
app.use("/api/view-batch", viewBatchRoutes);
app.use("/api/skills", skillsRoutes);
app.use("/api/free-slots", freeSlotsRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/users", userRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/suggestions", suggestionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/substitution", auth, substitutionRoutes);

// --- 2. SERVE STATIC FRONTEND FILES (for Production) ---

// UPDATED: The path now correctly points to the 'dist/spa' folder as defined in your Vite config.
const frontendBuildPath = path.join(__dirname, '../Prod-Ready-Frontend-FBD-main/dist/spa');
app.use(express.static(frontendBuildPath));


// --- 3. SPA CATCH-ALL ROUTE (for Production) ---
// This sends the main index.html file for any non-API, non-file request.
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});


// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});