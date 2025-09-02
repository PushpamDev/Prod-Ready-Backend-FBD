const express = require('express');
const cors = require('cors');
require('dotenv').config();

const studentsRouter = require('./routes/students');
const availabilityRouter = require('./routes/availability');
const freeSlotsRouter = require('./routes/freeSlots');
const activityRouter = require('./routes/activity');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: '*' })); // allow all origins for dev/testing
app.use(express.json());

// Routes
app.use('/api/skills', require('./routes/skills'));
app.use('/api/faculty', require('./routes/faculty'));
app.use('/api/batches', require('./routes/batches'));
app.use('/api/availability', availabilityRouter);
app.use('/api/students', studentsRouter);
app.use('/api/free-slots', freeSlotsRouter);
app.use('/api/activities', activityRouter);

// Start server on all interfaces so it's available on LAN
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on http://0.0.0.0:${PORT}`);

  // Helpful: log local LAN IP so you know what to use
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  Object.values(networkInterfaces).forEach(ifaces => {
    ifaces.forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`🌐 Access on LAN: http://${iface.address}:${PORT}`);
      }
    });
  });
});
