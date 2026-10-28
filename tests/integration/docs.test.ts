import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';

describe('OpenAPI Documentation & Prometheus Metrics', () => {
  it('GET /openapi.json serves valid OpenAPI 3.0.3 specification', async () => {
    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Enterprise Task Manager API');
    expect(res.body.paths).toBeDefined();

    // Verify key registered endpoints exist in the spec
    expect(res.body.paths['/auth/signup']).toBeDefined();
    expect(res.body.paths['/auth/login']).toBeDefined();
    expect(res.body.paths['/workspaces']).toBeDefined();
    expect(res.body.paths['/boards/{id}']).toBeDefined();
    expect(res.body.paths['/tasks/{id}']).toBeDefined();
    expect(res.body.paths['/boards/{id}/tasks']).toBeDefined();
    expect(res.body.paths['/attachments/{id}/url']).toBeDefined();
    expect(res.body.paths['/health']).toBeDefined();
    expect(res.body.paths['/ready']).toBeDefined();
    expect(res.body.paths['/metrics']).toBeDefined();
  });

  it('GET /docs serves interactive Swagger UI', async () => {
    const res = await request(app).get('/docs/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Swagger UI');
  });

  it('GET /metrics returns Prometheus formatted metrics', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toContain('taskmanager_');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds');
  });
});
