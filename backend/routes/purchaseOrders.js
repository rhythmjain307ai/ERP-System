const express = require('express');
const router = express.Router();
const controller = require('../controllers/purchaseController');

router.get('/', controller.list);
router.post('/', controller.create);
router.post('/:id/receive', controller.receive);

module.exports = router;
