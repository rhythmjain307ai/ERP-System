const express = require('express');
const router = express.Router();
const controller = require('../controllers/invoicesController');

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.post('/:id/payment', controller.recordPayment);

module.exports = router;
