import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// Placeholder for XSUAA credentials
const xsuaaConfig = {
  url: 'https://your-xsuaa-url',
  clientid: 'your-client-id',
  clientsecret: 'your-client-secret',
};

async function getAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  return axios.post(`${xsuaaConfig.url}/oauth/token`, params, {
    auth: {
      username: xsuaaConfig.clientid,
      password: xsuaaConfig.clientsecret,
    },
  }).then(res => res.data.access_token);
}

async function fetchEmployeeTime({ userId, reqStartDate, reqEndDate }, token) {
  const filter = `userId eq '${userId}' and startDate le ${reqEndDate} and endDate ge ${reqStartDate}`;
  const expand = `timeCalendar($filter=date ge ${reqStartDate} and date le ${reqEndDate})`;
  const url = `https://api55.sapsf.eu/odata/v2/employeeTime?$format=json&$filter=${encodeURIComponent(filter)}&$expand=${encodeURIComponent(expand)}`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data.d.results || [];
}

function computeSums(entries) {
  const summary = {
    vacationDays: 0,
    sickLeaveDays: 0,
    leaveDays: 0,
    sickLeaveShortLE3d: 0,
    sickLeaveShortGT3d: 0,
    sickLeaveLongLT8w: 0,
    sickLeaveLongGT8w: 0,
  };

  for (const entry of entries) {
    for (const cal of entry.timeCalendar.results) {
      const days = cal.quantity || 1; // default 1 day
      if (entry.timeType === '300') summary.vacationDays += days;
      if (['100','110','120','150'].includes(entry.timeType)) {
        summary.sickLeaveDays += days;
        if (cal.reportingCategory === 'SHORT_LE_3D') summary.sickLeaveShortLE3d += days;
        else if (cal.reportingCategory === 'SHORT_GT_3D') summary.sickLeaveShortGT3d += days;
        else if (cal.reportingCategory === 'LONG_LT_8W') summary.sickLeaveLongLT8w += days;
        else if (cal.reportingCategory === 'LONG_GT_8W') summary.sickLeaveLongGT8w += days;
      } else if (entry.timeType !== 'flex') {
        summary.leaveDays += days;
      }
    }
  }

  return summary;
}

async function updatePlannedWorkingTime({ userId, endOfMonth }, data, token) {
  const url = `https://api55.sapsf.eu/odata/v2/cust_plannedWorkingTime(userId='${userId}',startDate=datetime'${endOfMonth}')`;
  await axios.patch(url, {
    cust_vacationDays: data.vacationDays,
    cust_sickLeaveDays: data.sickLeaveDays,
    cust_leaveDays: data.leaveDays,
    cust_sickLeaveShortLE3d: data.sickLeaveShortLE3d,
    cust_sickLeaveShortGT3d: data.sickLeaveShortGT3d,
    cust_sickLeaveLongLT8w: data.sickLeaveLongLT8w,
    cust_sickLeaveLongGT8w: data.sickLeaveLongGT8w,
  }, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

app.post('/summary', async (req, res) => {
  const { userId, reqStartDate, reqEndDate } = req.body;
  if (!userId || !reqStartDate || !reqEndDate) {
    return res.status(400).send('Missing parameters');
  }

  try {
    const token = await getAccessToken();
    const entries = await fetchEmployeeTime({ userId, reqStartDate, reqEndDate }, token);
    const summary = computeSums(entries);
    const endOfMonth = new Date(reqEndDate);
    endOfMonth.setDate(new Date(endOfMonth.getFullYear(), endOfMonth.getMonth() + 1, 0).getDate());
    const endStr = endOfMonth.toISOString().split('T')[0];
    await updatePlannedWorkingTime({ userId, endOfMonth: endStr }, summary, token);
    res.json(summary);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error processing request');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
