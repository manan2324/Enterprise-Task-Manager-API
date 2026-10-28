import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3000';

export const options = {
  vus: 1,
  duration: '15s',
  thresholds: {
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<200'],
  },
};

export default function () {
  // Liveness & Readiness checks
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'health returns 200': (r) => r.status === 200 });

  const readyRes = http.get(`${BASE_URL}/ready`);
  check(readyRes, { 'ready returns 200': (r) => r.status === 200 });

  const metricsRes = http.get(`${BASE_URL}/metrics`);
  check(metricsRes, { 'metrics returns 200': (r) => r.status === 200 });

  const openapiRes = http.get(`${BASE_URL}/openapi.json`);
  check(openapiRes, { 'openapi returns 200': (r) => r.status === 200 });

  sleep(0.5);
}
