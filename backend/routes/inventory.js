const express = require('express');
const router = express.Router();
const controller = require('../controllers/inventoryController');

router.get('/', controller.list);
router.get('/low-stock', controller.lowStock);
router.post('/update-stock', controller.updateStock);

module.exports = router;
