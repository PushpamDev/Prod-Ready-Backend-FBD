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
const ceoRoutes = require("./routes/ceo");
const paymentLedgerRoutes = require('./routes/paymentLedgerRoutes');
const app = express();
const PORT = process.env.PORT || 3001;
const auth = require("./middleware/auth");

app.use(cors());
app.use(express.json());

// --- 1. API ROUTES ---
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
app.use("/api/substitution", auth, substitutionRoutes);
app.use('/api/intakes', intakeRoutes);
app.use('/', admissionUndertakingRoutes);
app.use('/api/batch-allotment', auth, batchAllotmentRoutes);
app.use("/api/ceo", auth, ceoRoutes); // Protected for Pushpam
app.use("/api/payment-ledger", auth, paymentLedgerRoutes);
// --- 2. SERVE STATIC FRONTEND FILES (for Production) ---
// Updated to match your actual local directory: /Users/rvmmedia/Desktop/Faridabad/Prod-Ready-Frontend-FBD-main/dist/spa
const frontendBuildPath = path.resolve(__dirname, '../../Prod-Ready-Frontend-FBD-main/dist/spa');

app.use(express.static(frontendBuildPath));

// --- 3. SPA CATCH-ALL ROUTE ---
// Resolves ENOENT error by ensuring the catch-all looks in the correct 'dist/spa' folder
app.get('*', (req, res) => {
  const indexFile = path.join(frontendBuildPath, 'index.html');
  res.sendFile(indexFile, (err) => {
    if (err) {
      console.error("Critical: Frontend build not found at path:", indexFile);
      res.status(404).send("Frontend build not found. Ensure you have run 'npm run build' in the frontend folder.");
    }
  });
});

// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});