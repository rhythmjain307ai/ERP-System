const express = require('express');
const router = express.Router();
const controller = require('../controllers/productionController');

router.get('/jobs', controller.listJobs);
router.post('/jobs', controller.createJob);
router.put('/jobs/:id/progress', controller.updateProgress);

module.exports = router;
