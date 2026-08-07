const express = require('express');
const { requireAuth, requireTenant } = require('../middleware/auth');
const { getQuota, getUsageToday } = require('../../db/quota');

const router = express.Router();
router.use(requireAuth, requireTenant);

router.get('/today', async (req, res) => {
  const [quota, usage] = await Promise.all([getQuota(req.tenantId), getUsageToday(req.tenantId)]);
  res.json({ quota, usage });
});

module.exports = router;
