import fs from 'node:fs';
import path from 'node:path';

interface PostmanHeader {
  key: string;
  value: string;
  type?: string;
  description?: string;
}

interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  body?: {
    mode: 'raw';
    raw: string;
    options: {
      raw: {
        language: 'json';
      };
    };
  };
  url: {
    raw: string;
    host: string[];
    path: string[];
    query?: Array<{ key: string; value: string; description?: string }>;
  };
  description?: string;
}

interface PostmanEvent {
  listen: 'test' | 'prerequest';
  script: {
    type: 'text/javascript';
    exec: string[];
  };
}

interface PostmanItem {
  name: string;
  event?: PostmanEvent[];
  request?: PostmanRequest;
  item?: PostmanItem[];
  description?: string;
}

const collection: {
  info: {
    _postman_id: string;
    name: string;
    description: string;
    schema: string;
  };
  auth: {
    type: 'bearer';
    bearer: Array<{ key: 'token'; value: string; type: 'string' }>;
  };
  variable: Array<{ key: string; value: string; type: string }>;
  item: PostmanItem[];
} = {
  info: {
    _postman_id: 'enterprise-task-manager-api-v1',
    name: 'Enterprise Task Manager API',
    description:
      'Comprehensive, production-grade Postman Collection covering all endpoints: System & Health, Auth, Workspaces, Members, Tags, Boards, Columns, Tasks, Subtasks, Comments, Activity Logs, and S3 Attachments.\n\nAll endpoints include automated environment variable chaining (tokens, workspace IDs, board IDs, task IDs) and response assertions.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [
      {
        key: 'token',
        value: '{{accessToken}}',
        type: 'string',
      },
    ],
  },
  variable: [
    {
      key: 'baseUrl',
      value: 'http://localhost:3000',
      type: 'string',
    },
  ],
  item: [],
};

// ── Helpers ──
function makeUrl(pathStr: string, query?: Array<{ key: string; value: string; description?: string }>) {
  const parts = pathStr.replace(/^\//, '').split('/');
  const rawQuery = query && query.length > 0 ? '?' + query.map((q) => `${q.key}=${q.value}`).join('&') : '';
  return {
    raw: `{{baseUrl}}/${parts.join('/')}${rawQuery}`,
    host: ['{{baseUrl}}'],
    path: parts,
    ...(query && query.length > 0 ? { query } : {}),
  };
}

function jsonHeaders(): PostmanHeader[] {
  return [{ key: 'Content-Type', value: 'application/json', type: 'text' }];
}

function testStatus(expectedCode: number, extraScript: string[] = []): PostmanEvent[] {
  return [
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          `pm.test("Status code is ${expectedCode}", function () {`,
          `    pm.response.to.have.status(${expectedCode});`,
          `});`,
          ...extraScript,
        ],
      },
    },
  ];
}

// ── Folder 1: System & Health ──
const systemFolder: PostmanItem = {
  name: '01. System & Health',
  description: 'Liveness, readiness probes, Prometheus RED metrics, and OpenAPI specification.',
  item: [
    {
      name: 'Health Check (Liveness)',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('health'),
        description: 'Returns 200 OK with server timestamp when Node.js HTTP server is active.',
      },
    },
    {
      name: 'Readiness Probe (DB & Redis)',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('ready'),
        description: 'Verifies real live connections to PostgreSQL (SELECT 1) and Redis (PING). Returns 503 if degraded.',
      },
    },
    {
      name: 'Prometheus Metrics',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('metrics'),
        description: 'Returns standard Prometheus exposition text format with HTTP RED metrics and process telemetry.',
      },
    },
    {
      name: 'OpenAPI Specification (Raw JSON)',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('openapi.json'),
        description: 'Auto-generated OpenAPI 3.1 specification schema derived from Zod validator definitions.',
      },
    },
  ],
};

// ── Folder 2: Authentication ──
const authFolder: PostmanItem = {
  name: '02. Authentication',
  description: 'User registration, argon2id password hashing, email verification, rotating refresh tokens with reuse detection, and password reset.',
  item: [
    {
      name: 'Signup (Register User)',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("registeredUserId", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              email: 'newuser_{{$timestamp}}@example.com',
              password: 'Password123!',
              name: 'Enterprise Professional',
              timezone: 'America/New_York',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('auth/signup'),
        description: 'Creates user account, hashes password with argon2id, and queues verification email.',
      },
    },
    {
      name: 'Verify Email',
      event: testStatus(200),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              token: '{{emailVerificationToken}}',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('auth/verify-email'),
        description: 'Consumes SHA-256 hashed verification token sent to MailHog.',
      },
    },
    {
      name: 'Login (Sets accessToken)',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.accessToken) {',
        '    pm.environment.set("accessToken", json.data.accessToken);',
        '    pm.environment.set("userId", json.data.user.id);',
        '    pm.environment.set("userEmail", json.data.user.email);',
        '    console.log("Logged in successfully as:", json.data.user.email);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              email: '{{email}}',
              password: '{{password}}',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('auth/login'),
        description: 'Authenticates credentials, returns 15m JWT accessToken, and sets HttpOnly refreshToken cookie.',
      },
    },
    {
      name: 'Refresh Token (Rotate Cookie)',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.accessToken) {',
        '    pm.environment.set("accessToken", json.data.accessToken);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: [],
        url: makeUrl('auth/refresh'),
        description: 'Rotates refresh token family. If an already-rotated token is reused, revokes the entire family.',
      },
    },
    {
      name: 'Forgot Password',
      event: testStatus(200),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              email: '{{email}}',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('auth/forgot-password'),
        description: 'Generates single-use password reset token with anti-enumeration (returns 200 even if email not found).',
      },
    },
    {
      name: 'Reset Password',
      event: testStatus(200),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              token: '{{passwordResetToken}}',
              newPassword: 'NewSecurePassword123!',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('auth/reset-password'),
        description: 'Resets password and invalidates all existing sessions/refresh tokens for the user.',
      },
    },
    {
      name: 'Logout',
      event: testStatus(200, [
        'pm.environment.set("accessToken", "");',
      ]),
      request: {
        method: 'POST',
        header: [],
        url: makeUrl('auth/logout'),
        description: 'Revokes the active refresh token family and clears the HttpOnly cookie.',
      },
    },
  ],
};

// ── Folder 3: Workspaces ──
const workspacesFolder: PostmanItem = {
  name: '03. Workspaces',
  description: 'Multi-tenant workspace isolation, creation, membership retrieval, and ownership controls.',
  item: [
    {
      name: 'Create Workspace',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("workspaceId", json.data.id);',
        '    pm.environment.set("workspaceSlug", json.data.slug);',
        '    console.log("Active Workspace ID set to:", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              name: 'Acme Global Operations',
              slug: 'acme-ops-{{$timestamp}}',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('workspaces'),
        description: 'Creates a workspace and atomically assigns the creator as OWNER.',
      },
    },
    {
      name: 'List Workspaces',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.length > 0 && !pm.environment.get("workspaceId")) {',
        '    pm.environment.set("workspaceId", json.data[0].id);',
        '}',
      ]),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('workspaces'),
        description: 'Returns only workspaces where the authenticated user is an active member.',
      },
    },
    {
      name: 'Get Workspace by ID',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('workspaces/{{workspaceId}}'),
        description: 'Retrieves workspace summary, active member counts, and user role.',
      },
    },
    {
      name: 'Update Workspace (Owner only)',
      event: testStatus(200),
      request: {
        method: 'PATCH',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              name: 'Acme Worldwide Engineering',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('workspaces/{{workspaceId}}'),
        description: 'Updates workspace details. Restricted to workspace OWNER.',
      },
    },
    {
      name: 'Delete Workspace (Owner only)',
      event: testStatus(200),
      request: {
        method: 'DELETE',
        header: [],
        url: makeUrl('workspaces/{{workspaceId}}'),
        description: 'Cascades deletion of boards, columns, tasks, and members. Restricted to OWNER.',
      },
    },
  ],
};

// ── Folder 4: Workspace Members & Invitations ──
const membersFolder: PostmanItem = {
  name: '04. Members & Invitations',
  description: 'Team collaboration, invitation lifecycle with SHA-256 tokens, and RBAC role assignments.',
  item: [
    {
      name: 'List Workspace Members',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.length > 0) {',
        '    pm.environment.set("memberUserId", json.data[0].userId || json.data[0].user.id);',
        '}',
      ]),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('workspaces/{{workspaceId}}/members'),
        description: 'Lists all members and their roles (OWNER, ADMIN, MEMBER, VIEWER).',
      },
    },
    {
      name: 'Invite Member (Admin/Owner)',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.token) {',
        '    pm.environment.set("invitationToken", json.data.token);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              email: 'colleague_{{$timestamp}}@example.com',
              role: 'MEMBER',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('workspaces/{{workspaceId}}/invitations'),
        description: 'Dispatches workspace invite token. Requires ADMIN or OWNER.',
      },
    },
    {
      name: 'Accept Invitation',
      event: testStatus(200),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              token: '{{invitationToken}}',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('invitations/accept'),
        description: 'Accepts invitation token and adds caller to workspace with specified role.',
      },
    },
    {
      name: 'Update Member Role (Admin/Owner)',
      event: testStatus(200),
      request: {
        method: 'PATCH',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              role: 'ADMIN',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('workspaces/{{workspaceId}}/members/{{memberUserId}}'),
        description: 'Promotes or demotes member role. Cannot demote the sole OWNER.',
      },
    },
    {
      name: 'Remove Member',
      event: testStatus(200),
      request: {
        method: 'DELETE',
        header: [],
        url: makeUrl('workspaces/{{workspaceId}}/members/{{memberUserId}}'),
        description: 'Removes member from workspace. Users can also call this to leave a workspace.',
      },
    },
  ],
};

// ── Folder 5: Workspace Tags ──
const tagsFolder: PostmanItem = {
  name: '05. Tags',
  description: 'Color-coded workspace-scoped tags for task organization and visual categorization.',
  item: [
    {
      name: 'Create Tag',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("tagId", json.data.id);',
        '    console.log("Created Tag ID:", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              name: 'Backend-Core',
              color: '#3B82F6',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('workspaces/{{workspaceId}}/tags'),
        description: 'Creates a tag within the workspace. Hex color codes supported.',
      },
    },
    {
      name: 'List Workspace Tags',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.length > 0 && !pm.environment.get("tagId")) {',
        '    pm.environment.set("tagId", json.data[0].id);',
        '}',
      ]),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('workspaces/{{workspaceId}}/tags'),
        description: 'Retrieves all tags defined in the workspace.',
      },
    },
  ],
};

// ── Folder 6: Boards & Columns ──
const boardsFolder: PostmanItem = {
  name: '06. Boards & Columns',
  description: 'Kanban boards, starter columns (Backlog, In Progress, Done), Redis cache-aside reads, and column positioning.',
  item: [
    {
      name: 'Create Board',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("boardId", json.data.id);',
        '    if (json.data.columns && json.data.columns.length > 0) {',
        '        pm.environment.set("columnId", json.data.columns[0].id);',
        '        console.log("Starter Column ID:", json.data.columns[0].id);',
        '    }',
        '    console.log("Created Board ID:", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              name: 'Sprint 24 - Core Platform',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('workspaces/{{workspaceId}}/boards'),
        description: 'Creates board with starter columns (Backlog, In Progress, Done) in an atomic transaction.',
      },
    },
    {
      name: 'List Workspace Boards',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.length > 0 && !pm.environment.get("boardId")) {',
        '    pm.environment.set("boardId", json.data[0].id);',
        '}',
      ]),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('workspaces/{{workspaceId}}/boards'),
        description: 'Lists all boards belonging to the workspace.',
      },
    },
    {
      name: 'Get Board Details (Redis Cached)',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.columns && json.data.columns.length > 0 && !pm.environment.get("columnId")) {',
        '    pm.environment.set("columnId", json.data.columns[0].id);',
        '}',
      ]),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('boards/{{boardId}}'),
        description: 'Returns board columns and task counts. Cached in Redis (TTL 300s); invalidated on mutations.',
      },
    },
    {
      name: 'Update Board',
      event: testStatus(200),
      request: {
        method: 'PATCH',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              name: 'Sprint 24 - Production Deployment',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('boards/{{boardId}}'),
        description: 'Updates board title and invalidates Redis cache entry.',
      },
    },
    {
      name: 'Create Column on Board',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("createdColumnId", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              name: 'QA & Staging',
              position: 2500,
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('boards/{{boardId}}/columns'),
        description: 'Appends a new column with fractional positioning.',
      },
    },
    {
      name: 'Update Column',
      event: testStatus(200),
      request: {
        method: 'PATCH',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              name: 'QA Validation',
              position: 2600,
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('columns/{{columnId}}'),
        description: 'Renames or reorders column.',
      },
    },
    {
      name: 'Delete Column',
      event: testStatus(200),
      request: {
        method: 'DELETE',
        header: [],
        url: makeUrl('columns/{{createdColumnId}}'),
        description: 'Deletes column and associated tasks. Invalidates board cache.',
      },
    },
    {
      name: 'Delete Board',
      event: testStatus(200),
      request: {
        method: 'DELETE',
        header: [],
        url: makeUrl('boards/{{boardId}}'),
        description: 'Deletes board and all nested columns and tasks.',
      },
    },
  ],
};

// ── Folder 7: Tasks ──
const tasksFolder: PostmanItem = {
  name: '07. Tasks',
  description: 'Task lifecycle: transactional creation, idempotency keys, optimistic concurrency versioning, fractional reordering, and keyset cursor search across 1M+ rows.',
  item: [
    {
      name: 'Create Task (Idempotent)',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("taskId", json.data.id);',
        '    pm.environment.set("taskVersion", json.data.version || 1);',
        '    console.log("Created Task ID:", json.data.id, "Version:", json.data.version);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: [
          ...jsonHeaders(),
          {
            key: 'Idempotency-Key',
            value: 'task-create-{{$guid}}',
            type: 'text',
            description: 'SHA-256 hashed idempotency key ensuring atomic single execution.',
          },
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              title: 'Implement OAuth2 PKCE Authorization Flow',
              description: 'Deliver secure RFC 7636 PKCE exchange for SPA and mobile clients.',
              status: 'TODO',
              priority: 'HIGH',
              dueDate: '2026-11-15T18:00:00.000Z',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('columns/{{columnId}}/tasks'),
        description: 'Creates task, appends monthly ActivityLog row, and writes OutboxEvent in a single transaction.',
      },
    },
    {
      name: 'Get Task by ID',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.version) {',
        '    pm.environment.set("taskVersion", json.data.version);',
        '}',
      ]),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('tasks/{{taskId}}'),
        description: 'Fetches full task detail including assignees, tags, subtasks, and comments.',
      },
    },
    {
      name: 'Search Board Tasks (Keyset Cursor Pagination)',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.nextCursor) {',
        '    pm.environment.set("tasksNextCursor", json.nextCursor);',
        '}',
      ]),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('boards/{{boardId}}/tasks', [
          { key: 'status', value: 'TODO', description: 'Filter by status' },
          { key: 'priority', value: 'HIGH', description: 'Filter by priority' },
          { key: 'limit', value: '20', description: 'Page size' },
        ]),
        description: 'High-performance keyset cursor pagination with parallel index streams across 1M+ tasks.',
      },
    },
    {
      name: 'Update Task (Optimistic Concurrency)',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.version) {',
        '    pm.environment.set("taskVersion", json.data.version);',
        '}',
      ]),
      request: {
        method: 'PATCH',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              title: 'Implement OAuth2 PKCE Flow (Reviewed)',
              status: 'IN_PROGRESS',
              priority: 'URGENT',
              version: 1,
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}'),
        description: 'Atomic update guarded by version check. Returns 409 VERSION_CONFLICT if stale.',
      },
    },
    {
      name: 'Move Task (Fractional Positioning)',
      event: testStatus(200),
      request: {
        method: 'PATCH',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              columnId: '{{columnId}}',
              targetPosition: 1500,
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/move'),
        description: 'Moves task across columns or reorders within column using midpoint fractional arithmetic.',
      },
    },
    {
      name: 'Update Task Assignees',
      event: testStatus(200),
      request: {
        method: 'PUT',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              userIds: ['{{userId}}'],
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/assignees'),
        description: 'Sets assignees and dispatches transactional assignment notification events.',
      },
    },
    {
      name: 'Update Task Tags',
      event: testStatus(200),
      request: {
        method: 'PUT',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              tagIds: ['{{tagId}}'],
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/tags'),
        description: 'Attaches or synchronizes workspace tags on task.',
      },
    },
    {
      name: 'Delete Task (Soft Delete)',
      event: testStatus(200),
      request: {
        method: 'DELETE',
        header: [],
        url: makeUrl('tasks/{{taskId}}'),
        description: 'Sets deletedAt timestamp and appends task.deleted activity record.',
      },
    },
  ],
};

// ── Folder 8: Subtasks ──
const subtasksFolder: PostmanItem = {
  name: '08. Subtasks',
  description: 'Hierarchical checklist items nested under parent tasks.',
  item: [
    {
      name: 'Create Subtask',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("subtaskId", json.data.id);',
        '    console.log("Created Subtask ID:", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              title: 'Write RFC unit tests for SHA-256 code challenge',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/subtasks'),
        description: 'Adds subtask to parent task.',
      },
    },
    {
      name: 'Update Subtask (Mark Done)',
      event: testStatus(200),
      request: {
        method: 'PATCH',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              title: 'Write RFC unit tests for SHA-256 code challenge (Completed)',
              done: true,
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/subtasks/{{subtaskId}}'),
        description: 'Toggles completion status or updates subtask title.',
      },
    },
    {
      name: 'Delete Subtask',
      event: testStatus(200),
      request: {
        method: 'DELETE',
        header: [],
        url: makeUrl('tasks/{{taskId}}/subtasks/{{subtaskId}}'),
        description: 'Deletes subtask from parent task.',
      },
    },
  ],
};

// ── Folder 9: Comments ──
const commentsFolder: PostmanItem = {
  name: '09. Comments',
  description: 'Team discussion threads with markdown body support and author relation hydration.',
  item: [
    {
      name: 'Create Comment (Idempotent)',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("commentId", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: [
          ...jsonHeaders(),
          {
            key: 'Idempotency-Key',
            value: 'comment-{{$guid}}',
            type: 'text',
          },
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              body: 'Architecture review looks clean! Verified with load test harness.',
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/comments'),
        description: 'Posts comment on task and records activity entry.',
      },
    },
    {
      name: 'List Task Comments',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('tasks/{{taskId}}/comments'),
        description: 'Returns discussion thread ordered chronologically with author user details.',
      },
    },
  ],
};

// ── Folder 10: Activity Log & Audit Trail ──
const activityFolder: PostmanItem = {
  name: '10. Activity Log & Audit Trail',
  description: 'Enterprise monthly-partitioned audit trails capturing all state mutations with JSON metadata diffs.',
  item: [
    {
      name: 'Get Task Activity Trail',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('tasks/{{taskId}}/activity'),
        description: 'Returns audit history of mutations (created, updated, moved, assigned, deleted) for a task.',
      },
    },
    {
      name: 'Get Board Activity Trail',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('boards/{{boardId}}/activity'),
        description: 'Returns real-time event feed of all activity across the board.',
      },
    },
  ],
};

// ── Folder 11: Attachments (S3 / R2 Pre-signed Flow) ──
const attachmentsFolder: PostmanItem = {
  name: '11. Attachments (S3 / R2 Flow)',
  description: 'Direct-to-storage upload pattern using pre-signed PUT and GET URLs. Server never buffers large binary files in memory.',
  item: [
    {
      name: '1. Request Pre-signed Upload URL',
      event: testStatus(200, [
        'var json = pm.response.json();',
        'if (json.data && json.data.key) {',
        '    pm.environment.set("attachmentKey", json.data.key);',
        '    pm.environment.set("uploadUrl", json.data.url);',
        '    console.log("Pre-signed upload key:", json.data.key);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              fileName: 'architecture-diagram.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1048576,
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/attachments/presign'),
        description: 'Validates file extension and size, then returns pre-signed S3 PUT URL and storage key.',
      },
    },
    {
      name: '2. Confirm Upload & Register Attachment',
      event: testStatus(201, [
        'var json = pm.response.json();',
        'if (json.data && json.data.id) {',
        '    pm.environment.set("attachmentId", json.data.id);',
        '    console.log("Confirmed Attachment ID:", json.data.id);',
        '}',
      ]),
      request: {
        method: 'POST',
        header: jsonHeaders(),
        body: {
          mode: 'raw',
          raw: JSON.stringify(
            {
              key: '{{attachmentKey}}',
              fileName: 'architecture-diagram.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1048576,
            },
            null,
            2,
          ),
          options: { raw: { language: 'json' } },
        },
        url: makeUrl('tasks/{{taskId}}/attachments/confirm'),
        description: 'Registers uploaded object into PostgreSQL database and associates it with task.',
      },
    },
    {
      name: '3. List Task Attachments',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('tasks/{{taskId}}/attachments'),
        description: 'Lists all metadata records of files attached to this task.',
      },
    },
    {
      name: '4. Get Pre-signed Download URL',
      event: testStatus(200),
      request: {
        method: 'GET',
        header: [],
        url: makeUrl('attachments/{{attachmentId}}/url'),
        description: 'Generates secure time-limited GET pre-signed URL to download file directly from S3.',
      },
    },
    {
      name: '5. Delete Attachment',
      event: testStatus(200),
      request: {
        method: 'DELETE',
        header: [],
        url: makeUrl('attachments/{{attachmentId}}'),
        description: 'Deletes file from S3 bucket and removes row from Attachment table.',
      },
    },
  ],
};

// ── Assembly ──
collection.item = [
  systemFolder,
  authFolder,
  workspacesFolder,
  membersFolder,
  tagsFolder,
  boardsFolder,
  tasksFolder,
  subtasksFolder,
  commentsFolder,
  activityFolder,
  attachmentsFolder,
];

// ── Environment File ──
const environment = {
  id: 'enterprise-task-manager-environment-v1',
  name: 'Enterprise Task Manager - Local / Dev',
  values: [
    { key: 'baseUrl', value: 'http://localhost:3000', enabled: true },
    { key: 'email', value: 'owner@example.com', enabled: true },
    { key: 'password', value: 'Password123!', enabled: true },
    { key: 'accessToken', value: '', enabled: true },
    { key: 'userId', value: '', enabled: true },
    { key: 'userEmail', value: '', enabled: true },
    { key: 'workspaceId', value: '', enabled: true },
    { key: 'workspaceSlug', value: '', enabled: true },
    { key: 'memberUserId', value: '', enabled: true },
    { key: 'invitationToken', value: '', enabled: true },
    { key: 'emailVerificationToken', value: '', enabled: true },
    { key: 'passwordResetToken', value: '', enabled: true },
    { key: 'tagId', value: '', enabled: true },
    { key: 'boardId', value: '', enabled: true },
    { key: 'columnId', value: '', enabled: true },
    { key: 'createdColumnId', value: '', enabled: true },
    { key: 'taskId', value: '', enabled: true },
    { key: 'taskVersion', value: '1', enabled: true },
    { key: 'tasksNextCursor', value: '', enabled: true },
    { key: 'subtaskId', value: '', enabled: true },
    { key: 'commentId', value: '', enabled: true },
    { key: 'attachmentKey', value: '', enabled: true },
    { key: 'attachmentId', value: '', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

const outputDir = path.resolve('postman');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(
  path.join(outputDir, 'enterprise-task-manager.postman_collection.json'),
  JSON.stringify(collection, null, 2),
  'utf-8',
);

fs.writeFileSync(
  path.join(outputDir, 'enterprise-task-manager.postman_environment.json'),
  JSON.stringify(environment, null, 2),
  'utf-8',
);

console.log('✅ Generated Postman collection with', collection.item.length, 'organized folders and 51 endpoints.');
console.log('   ↳ postman/enterprise-task-manager.postman_collection.json');
console.log('   ↳ postman/enterprise-task-manager.postman_environment.json');
