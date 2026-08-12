/**
 * Craghan Contact - API Function Tests
 * Tests for api/send.js (Resend proxy) and api/data.js (Supabase proxy)
 *
 * Run with: node tests/api.test.mjs
 */

// ── Minimal mock for req/res ──────────────────────────────────────
function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
}

function mockReq({ method = "POST", body = {}, query = {} } = {}) {
  return { method, body, query };
}

// ── Fetch mock ────────────────────────────────────────────────────
let fetchCalls = [];
let fetchResponses = [];

globalThis.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  const next = fetchResponses.shift();
  if (!next) throw new Error(`Unexpected fetch call to ${url}`);
  return {
    ok: next.ok ?? true,
    status: next.status ?? 200,
    json: async () => next.body,
  };
};

function expectFetch(response) {
  fetchResponses.push(response);
}

function resetFetch() {
  fetchCalls = [];
  fetchResponses = [];
}

// ── Test runner ───────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    resetFetch();
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function expect(actual) {
  return {
    toBe: (expected) => {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual: (expected) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toContain: (expected) => {
      if (!JSON.stringify(actual).includes(expected))
        throw new Error(`Expected result to contain "${expected}", got ${JSON.stringify(actual)}`);
    },
    toBeTruthy: () => {
      if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`);
    },
    toBeNull: () => {
      if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
  };
}

// ── Load handlers ─────────────────────────────────────────────────
const { default: sendHandler } = await import("../api/send.js");

// data.js needs env vars set before import
process.env.SUPABASE_URL      = "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
const { default: dataHandler } = await import("../api/data.js");

// ══════════════════════════════════════════════════════════════════
console.log("\n📧 send.js — Resend proxy\n");

await test("rejects non-POST requests", async () => {
  const req = mockReq({ method: "GET" });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(405);
  expect(res._body.error).toBe("Method not allowed");
});

await test("rejects missing apiKey", async () => {
  const req = mockReq({ body: { to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" } });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(400);
  expect(res._body.error).toContain("Missing required fields");
});

await test("rejects missing to", async () => {
  const req = mockReq({ body: { apiKey: "re_test", subject: "Hi", html: "<p>Hi</p>" } });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(400);
});

await test("rejects missing subject", async () => {
  const req = mockReq({ body: { apiKey: "re_test", to: "a@b.com", html: "<p>Hi</p>" } });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(400);
});

await test("rejects missing html", async () => {
  const req = mockReq({ body: { apiKey: "re_test", to: "a@b.com", subject: "Hi" } });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(400);
});

await test("sends plain email successfully", async () => {
  expectFetch({ ok: true, status: 200, body: { id: "email-123" } });
  const req = mockReq({ body: { apiKey: "re_test", from: "Drew <drew@craghancc.com>", to: "buyer@store.com", subject: "New Collection", html: "<p>Hello!</p>" } });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(200);
  expect(res._body.id).toBe("email-123");
  // Verify Resend was called with correct auth
  expect(fetchCalls[0].options.headers.Authorization).toBe("Bearer re_test");
  // Verify to is array
  const sentBody = JSON.parse(fetchCalls[0].options.body);
  expect(sentBody.to).toEqual(["buyer@store.com"]);
});

await test("sends email with PDF attachment", async () => {
  expectFetch({ ok: true, status: 200, body: { id: "email-456" } });
  const req = mockReq({
    body: {
      apiKey: "re_test",
      from: "Drew <drew@craghancc.com>",
      to: "buyer@store.com",
      subject: "Catalog",
      html: "<p>See attached.</p>",
      attachments: [{ filename: "catalog.pdf", content: "base64encodedpdfcontent==" }],
    }
  });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(200);
  const sentBody = JSON.parse(fetchCalls[0].options.body);
  expect(sentBody.attachments[0].filename).toBe("catalog.pdf");
  expect(sentBody.attachments[0].content).toBe("base64encodedpdfcontent==");
});

await test("sends email without attachments when array is empty", async () => {
  expectFetch({ ok: true, status: 200, body: { id: "email-789" } });
  const req = mockReq({
    body: { apiKey: "re_test", from: "Drew <drew@craghancc.com>", to: "buyer@store.com", subject: "Hi", html: "<p>Hi</p>", attachments: [] }
  });
  const res = mockRes();
  await sendHandler(req, res);
  const sentBody = JSON.parse(fetchCalls[0].options.body);
  expect(sentBody.attachments).toBeNull();  // not included when empty
});

await test("handles Resend API error gracefully", async () => {
  expectFetch({ ok: false, status: 422, body: { message: "Invalid email address" } });
  const req = mockReq({ body: { apiKey: "re_test", from: "Drew <drew@craghancc.com>", to: "notanemail", subject: "Hi", html: "<p>Hi</p>" } });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(422);
  expect(res._body.error).toBe("Invalid email address");
});

await test("handles network error gracefully", async () => {
  fetchResponses.push(null); // will throw
  globalThis.fetch = async () => { throw new Error("Network failure"); };
  const req = mockReq({ body: { apiKey: "re_test", from: "Drew <drew@craghancc.com>", to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" } });
  const res = mockRes();
  await sendHandler(req, res);
  expect(res._status).toBe(500);
  expect(res._body.error).toBe("Network failure");
  // Restore fetch mock
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    const next = fetchResponses.shift();
    if (!next) throw new Error(`Unexpected fetch call to ${url}`);
    return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body };
  };
});

// ══════════════════════════════════════════════════════════════════
console.log("\n☁️  data.js — Supabase proxy\n");

await test("returns 500 when env vars missing", async () => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  // Need a fresh import without cache — simulate by calling with missing vars
  // We test this by directly calling with mocked missing vars
  const req = mockReq({ method: "GET", query: { key: "test" } });
  const res = mockRes();
  // Manually simulate missing env
  const origUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_ANON_KEY = "";
  await dataHandler(req, res);
  expect(res._status).toBe(500);
  process.env.SUPABASE_URL = savedUrl;
  process.env.SUPABASE_ANON_KEY = savedKey;
});

await test("GET returns null for missing key", async () => {
  expectFetch({ ok: true, body: [] }); // Supabase returns empty array for no match
  const req = mockReq({ method: "GET", query: { key: "craghan-contact:contacts" } });
  const res = mockRes();
  await dataHandler(req, res);
  expect(res._status).toBe(200);
  expect(res._body.value).toBeNull();
});

await test("GET returns value when key exists", async () => {
  expectFetch({ ok: true, body: [{ value: { contacts: [{ name: "Jane", email: "jane@store.com" }] } }] });
  const req = mockReq({ method: "GET", query: { key: "craghan-contact:contacts" } });
  const res = mockRes();
  await dataHandler(req, res);
  expect(res._status).toBe(200);
  expect(res._body.value.contacts[0].name).toBe("Jane");
});

await test("GET rejects missing key param", async () => {
  const req = mockReq({ method: "GET", query: {} });
  const res = mockRes();
  await dataHandler(req, res);
  expect(res._status).toBe(400);
  expect(res._body.error).toBe("Missing key");
});

await test("POST writes value to Supabase", async () => {
  expectFetch({ ok: true, status: 201, body: {} });
  const req = mockReq({ method: "POST", body: { key: "craghan-contact:contacts", value: [{ name: "Bob", email: "bob@store.com" }] } });
  const res = mockRes();
  await dataHandler(req, res);
  expect(res._status).toBe(200);
  expect(res._body.ok).toBe(true);
  // Verify upsert header sent
  expect(fetchCalls[0].options.headers["Prefer"]).toBe("resolution=merge-duplicates");
});

await test("POST rejects missing key", async () => {
  const req = mockReq({ method: "POST", body: { value: [{ name: "Bob" }] } });
  const res = mockRes();
  await dataHandler(req, res);
  expect(res._status).toBe(400);
  expect(res._body.error).toBe("Missing key");
});

await test("POST uses correct Supabase URL", async () => {
  expectFetch({ ok: true, status: 201, body: {} });
  const req = mockReq({ method: "POST", body: { key: "craghan-contact:settings", value: { resendKey: "re_xyz" } } });
  const res = mockRes();
  await dataHandler(req, res);
  expect(fetchCalls[0].url).toBe("https://test.supabase.co/rest/v1/kv_store");
});

await test("GET encodes special characters in key", async () => {
  expectFetch({ ok: true, body: [] });
  const req = mockReq({ method: "GET", query: { key: "craghan-contact:lists" } });
  const res = mockRes();
  await dataHandler(req, res);
  expect(fetchCalls[0].url).toContain("craghan-contact%3Alists");
});

await test("rejects unsupported HTTP methods", async () => {
  const req = mockReq({ method: "DELETE" });
  const res = mockRes();
  await dataHandler(req, res);
  expect(res._status).toBe(405);
});

await test("handles Supabase error on write", async () => {
  expectFetch({ ok: false, status: 403, body: { message: "Row level security violation" } });
  const req = mockReq({ method: "POST", body: { key: "craghan-contact:contacts", value: [] } });
  const res = mockRes();
  await dataHandler(req, res);
  expect(res._status).toBe(403);
  expect(res._body.error).toBe("Row level security violation");
});

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(40)}\n`);
if (failed > 0) process.exit(1);
