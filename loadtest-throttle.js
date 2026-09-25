import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    // expect the throttler to be actively blocking excess traffic
    'checks{check:throttled or ok}': ['rate>0.95'],
  },
};

export default function () {
  const res = http.get('https://ajodaddy.onrender.com/api/platform/status');

  check(res, {
    'throttled or ok': (r) => r.status === 200 || r.status === 429,
    'no server crash (5xx)': (r) => r.status < 500,
  });

  if (res.status === 429) {
    console.log(`Throttled as expected: ${res.timestamp}`);
  } else if (res.status >= 500) {
    console.log(`UNEXPECTED CRASH: status=${res.status} body=${res.body}`);
  }

  sleep(1);
}