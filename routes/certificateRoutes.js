const express = require('express');
const router = express.Router();
const certificateController = require('../controllers/certificateController');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// Public route to get all certificates
router.get('/', certificateController.getAllCertificates);

// Public route to get a single certificate by ID
router.get('/:id', certificateController.getCertificateById);

// Protected admin routes
router.post('/', auth, admin, certificateController.createCertificate);
router.put('/:id', auth, admin, certificateController.updateCertificate);
router.delete('/:id', auth, admin, certificateController.deleteCertificate);

module.exports = router;