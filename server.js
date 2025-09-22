require('dotenv').config();
const express = require("express");
const cors = require("cors");
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

const app = express();
const PORT = process.env.PORT || 3001;

const auth = require("./middleware/auth");

app.use(cors());
app.use(express.json());

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
app.use("/api/announcements",announcementRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});