import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('real_errors');   // 5xx, timeouts, connection issues
const throttled = new Rate('throttled_429'); // rate-limited, not a crash
const reqDuration = new Trend('req_duration_ms');

export const options = {
  scenarios: {
    ramping_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 200 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    real_errors: ['rate<0.01'],       // fail test if >1% real server errors
    http_req_duration: ['p(95)<2000'], // fail test if p95 latency > 2s
  },
};

export default function () {
  const res = http.get('https://ajodaddy.onrender.com/api/platform/status');

  reqDuration.add(res.timings.duration);

  if (res.status === 429) {
    throttled.add(1);
    errorRate.add(0);
  } else if (res.status >= 500 || res.status === 0) {
    errorRate.add(1);
    throttled.add(0);
    console.log(`CRASH/ERROR: status=${res.status} body=${res.body}`);
  } else {
    errorRate.add(0);
    throttled.add(0);
  }

  check(res, {
    'not a server error': (r) => r.status < 500 && r.status !== 0,
  });

  sleep(1);
}