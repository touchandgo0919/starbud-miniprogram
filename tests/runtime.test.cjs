const assert = require("node:assert/strict");
const { beforeEach, describe, test } = require("node:test");

const storage = new Map();
const requestCalls = [];
const uploadCalls = [];
const navigationCalls = [];
const toastCalls = [];
let nextRequestResponse;
let nextUploadResponse;

global.getApp = () => ({ globalData: { session: null } });
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  request(options) {
    requestCalls.push(options);
    const response = nextRequestResponse || { statusCode: 200, data: {} };
    queueMicrotask(() => response.fail ? options.fail(response.fail) : options.success(response));
  },
  uploadFile(options) {
    uploadCalls.push(options);
    const response = nextUploadResponse || { statusCode: 200, data: "{}" };
    queueMicrotask(() => response.fail ? options.fail(response.fail) : options.success(response));
  },
  reLaunch(options) {
    navigationCalls.push(["reLaunch", options]);
  },
  switchTab(options) {
    navigationCalls.push(["switchTab", options]);
  },
  showToast(options) {
    toastCalls.push(options);
  }
};

function resetModules() {
  for (const path of [
    "../utils/request",
    "../utils/storage",
    "../services/api",
    "../pages/login/index"
  ]) {
    delete require.cache[require.resolve(path)];
  }
}

beforeEach(() => {
  storage.clear();
  requestCalls.length = 0;
  uploadCalls.length = 0;
  navigationCalls.length = 0;
  toastCalls.length = 0;
  nextRequestResponse = undefined;
  nextUploadResponse = undefined;
  global.getApp = () => ({ globalData: { session: null } });
  resetModules();
});

describe("mini-program request runtime", () => {
  test("adds authentication and stable mini-program tracking headers", async () => {
    storage.set("starbud.childSession", { token: "child-token", user: { role: "child" } });
    nextRequestResponse = { statusCode: 200, data: { tasks: [] } };
    const { request } = require("../utils/request");

    await request("/api/tasks/today");
    await request("/api/notifications");

    assert.equal(requestCalls[0].header.authorization, "Bearer child-token");
    assert.equal(requestCalls[0].header["x-starbud-client"], "mini_program");
    assert.ok(requestCalls[0].header["x-starbud-session-id"]);
    assert.equal(
      requestCalls[0].header["x-starbud-session-id"],
      requestCalls[1].header["x-starbud-session-id"]
    );
    assert.match(requestCalls[0].url, /^https:\/\//);
    assert.equal(requestCalls[0].timeout, 15000);
  });

  test("does not send a stale token during login", async () => {
    storage.set("starbud.childSession", { token: "stale-token" });
    nextRequestResponse = {
      statusCode: 200,
      data: { user: { id: "c1", role: "child" }, token: "fresh-token" }
    };
    const api = require("../services/api");

    await api.login("child", "password");

    assert.equal(requestCalls[0].method, "POST");
    assert.deepEqual(requestCalls[0].data, { username: "child", password: "password" });
    assert.equal(requestCalls[0].header.authorization, undefined);
  });

  test("registers a parent without sending a stale token", async () => {
    storage.set("starbud.childSession", { token: "stale-token" });
    nextRequestResponse = {
      statusCode: 201,
      data: { user: { id: "p1", role: "parent" }, token: "parent-token" }
    };
    const api = require("../services/api");

    await api.registerParent("new.parent", "新家长", "password");

    assert.match(requestCalls[0].url, /\/api\/auth\/register$/);
    assert.deepEqual(requestCalls[0].data, {
      username: "new.parent",
      displayName: "新家长",
      password: "password"
    });
    assert.equal(requestCalls[0].header.authorization, undefined);
  });

  test("clears the session and redirects on authenticated 401 responses", async () => {
    const app = { globalData: { session: { token: "expired" } } };
    global.getApp = () => app;
    storage.set("starbud.childSession", { token: "expired" });
    storage.set("starbud.selectedTask", { id: "task-1" });
    nextRequestResponse = { statusCode: 401, data: { error: "Unauthorized" } };
    const { request } = require("../utils/request");

    await assert.rejects(request("/api/me"), (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.message, "Unauthorized");
      return true;
    });
    assert.equal(storage.has("starbud.childSession"), false);
    assert.equal(storage.has("starbud.selectedTask"), false);
    assert.equal(app.globalData.session, null);
    assert.deepEqual(navigationCalls[0], ["reLaunch", { url: "/pages/login/index" }]);
  });

  test("reports transport failures and malformed upload responses", async () => {
    nextRequestResponse = { fail: { errMsg: "request:fail timeout" } };
    const { request, upload } = require("../utils/request");
    await assert.rejects(request("/api/tasks"), /request:fail timeout/);

    nextUploadResponse = { statusCode: 200, data: "not-json" };
    await assert.rejects(upload("/api/submissions/s1/photos", "/tmp/photo.png"), /响应格式错误/);
  });
});

describe("mini-program sharing", () => {
  test("uses the app name and branded share image", () => {
    const { BRAND_NAME, SHARE_IMAGE_URL, buildSharePayload } = require("../utils/share");

    assert.equal(BRAND_NAME, "星星芽AI助手");
    assert.equal(SHARE_IMAGE_URL, "/assets/starbud-share.png");
    assert.deepEqual(buildSharePayload("我的任务", "/pages/tasks/index"), {
      title: "星星芽AI助手 · 我的任务",
      imageUrl: "/assets/starbud-share.png",
      path: "/pages/tasks/index"
    });
    assert.deepEqual(buildSharePayload("我的提交"), {
      title: "星星芽AI助手 · 我的提交",
      imageUrl: "/assets/starbud-share.png"
    });
    assert.deepEqual(buildSharePayload("关于我们", "/pages/profile/index"), {
      title: "星星芽AI助手 · 关于我们",
      imageUrl: "/assets/starbud-share.png",
      path: "/pages/profile/index"
    });
  });
});

describe("mini-program API facade", () => {
  test("loads the child next-step suggestion", async () => {
    nextRequestResponse = {
      statusCode: 200,
      data: { nextStep: { title: "先领取数学作业", taskId: "t1", stage: "claim" } }
    };
    const api = require("../services/api");

    const nextStep = await api.getChildNextStep();

    assert.equal(nextStep.taskId, "t1");
    assert.match(requestCalls[0].url, /\/api\/ai\/child-next-step$/);
  });

  test("encodes paging filters and returns backend pagination", async () => {
    nextRequestResponse = {
      statusCode: 200,
      data: { tasks: [{ id: "t1" }], pagination: { page: 2, pageSize: 20, total: 21, hasMore: false } }
    };
    const api = require("../services/api");

    const result = await api.getTaskPage({
      page: 2,
      pageSize: 20,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      scope: "definitions"
    });

    assert.equal(result.pagination.total, 21);
    assert.match(requestCalls[0].url, /page=2&pageSize=20/);
    assert.match(requestCalls[0].url, /dateFrom=2026-08-01/);
    assert.match(requestCalls[0].url, /scope=definitions/);
  });

  test("sends task dates for claim and submission creation", async () => {
    const api = require("../services/api");
    nextRequestResponse = { statusCode: 200, data: { task: { id: "t1", claimedAt: "now" } } };
    await api.claimTask("t1", "2026-08-06");
    assert.deepEqual(requestCalls[0].data, { taskDate: "2026-08-06" });

    nextRequestResponse = { statusCode: 201, data: { submission: { id: "s1" } } };
    await api.createSubmission("t1", "说明", "2026-08-06");
    assert.deepEqual(requestCalls[1].data, { note: "说明", taskDate: "2026-08-06" });
  });

  test("uses uploadFile fields for photos and audio duration", async () => {
    const api = require("../services/api");
    nextUploadResponse = { statusCode: 201, data: JSON.stringify({ photo: { id: "p1" } }) };
    await api.uploadSubmissionPhoto("s1", "/tmp/photo.png");
    assert.equal(uploadCalls[0].name, "photo");
    assert.equal(uploadCalls[0].filePath, "/tmp/photo.png");

    nextUploadResponse = { statusCode: 201, data: JSON.stringify({ audio: { id: "a1" } }) };
    await api.uploadSubmissionAudio("s1", "/tmp/audio.mp3", 2300);
    assert.equal(uploadCalls[1].name, "audio");
    assert.deepEqual(uploadCalls[1].formData, { durationMs: "2300" });
    assert.equal(uploadCalls[1].timeout, 30000);
  });

  test("normalizes every current and historical protected file URL", async () => {
    nextRequestResponse = {
      statusCode: 200,
      data: {
        submission: {
          id: "s1",
          photos: [{ id: "p1", url: "/api/submission-files/p1?token=x" }],
          audio: { id: "a1", url: "/api/submission-audio/a1?token=x" },
          reviewImageUrl: "/api/review-files/r1?token=x",
          reviewRounds: [{
            id: "round-1",
            photos: [{ id: "old-p", url: "/api/review-round-photos/round-1/0?token=x" }],
            audios: [{ id: "old-a", url: "/api/review-round-audios/round-1/0?token=x" }],
            reviewImages: [],
            reviewImageUrl: "/api/review-round-files/round-1?token=x",
            reviewedAt: "2026-08-06 12:00:00"
          }]
        }
      }
    };
    const api = require("../services/api");

    const submission = await api.getTaskSubmission("t1", "2026-08-06");

    assert.ok(submission.photos[0].url.startsWith("https://"));
    assert.ok(submission.audio.url.startsWith("https://"));
    assert.ok(submission.reviewImageUrl.startsWith("https://"));
    assert.ok(submission.reviewRounds[0].photos[0].url.startsWith("https://"));
    assert.ok(submission.reviewRounds[0].audios[0].url.startsWith("https://"));
    assert.ok(submission.reviewRounds[0].reviewImages[0].url.startsWith("https://"));
  });
});

describe("task guidance ladder", () => {
  const { buildTaskGuidance } = require("../utils/guidance");

  test("moves from claim to attachment submission", () => {
    const unclaimed = buildTaskGuidance({ status: "pending", reviewStatus: "pending_submission", requiresPhotoUpload: true });
    assert.equal(unclaimed.title, "先领取这个任务");
    assert.deepEqual(unclaimed.steps.map((item) => item.state), ["active", "upcoming", "upcoming"]);

    const claimed = buildTaskGuidance({ status: "pending", reviewStatus: "pending_submission", requiresPhotoUpload: true, claimedAt: "2026-08-07 18:00:00" });
    assert.equal(claimed.title, "完成后提交附件");
    assert.deepEqual(claimed.steps.map((item) => item.state), ["done", "active", "upcoming"]);
  });

  test("shows revision, review waiting and completion states", () => {
    const revision = buildTaskGuidance({ status: "pending", reviewStatus: "needs_revision", requiresPhotoUpload: true, claimedAt: "now", needsRevision: true });
    assert.equal(revision.title, "按批改内容修改");
    assert.equal(revision.steps[1].label, "修改并重交");

    const waiting = buildTaskGuidance({ status: "pending", reviewStatus: "pending_review", submissionStatus: "submitted", requiresPhotoUpload: true, claimedAt: "now" });
    assert.equal(waiting.title, "等待家长批改");
    assert.deepEqual(waiting.steps.map((item) => item.state), ["done", "done", "active"]);

    const completed = buildTaskGuidance({ status: "completed", reviewStatus: "completed", requiresPhotoUpload: true, finalizedAt: "now" });
    assert.equal(completed.title, "任务已经完成");
    assert.deepEqual(completed.steps.map((item) => item.state), ["done", "done", "done"]);
  });
});

describe("login page", () => {
  function loadPage() {
    let definition;
    global.Page = (pageDefinition) => {
      definition = pageDefinition;
    };
    require("../pages/login/index");
    return {
      ...definition,
      data: { ...definition.data },
      setData(update) {
        Object.assign(this.data, update);
      }
    };
  }

  test("validates credentials and agreement before making a request", async () => {
    const page = loadPage();
    await page.submit();
    assert.equal(page.data.error, "请输入用户名和密码。");

    page.setData({ username: "child", password: "password" });
    await page.submit();
    assert.match(page.data.error, /请先阅读并同意/);
    assert.equal(requestCalls.length, 0);
  });

  test("stores an allowed account and enters the task tab", async () => {
    const app = { globalData: { session: null } };
    global.getApp = () => app;
    nextRequestResponse = {
      statusCode: 200,
      data: { user: { id: "c1", username: "child", role: "child" }, token: "token-1" }
    };
    const page = loadPage();
    page.setData({ username: " child ", password: "password", agreementAccepted: true });

    await page.submit();

    assert.equal(storage.get("starbud.childSession").token, "token-1");
    assert.equal(app.globalData.session.token, "token-1");
    assert.deepEqual(navigationCalls.at(-1), ["switchTab", { url: "/pages/tasks/index" }]);
    assert.equal(page.data.submitting, false);
  });

  test("rejects admin accounts even when backend authentication succeeds", async () => {
    nextRequestResponse = {
      statusCode: 200,
      data: { user: { id: "a1", username: "admin", role: "admin" }, token: "admin-token" }
    };
    const page = loadPage();
    page.setData({ username: "admin", password: "password", agreementAccepted: true });

    await page.submit();

    assert.match(page.data.error, /家长或儿童账号/);
    assert.equal(storage.has("starbud.childSession"), false);
  });

  test("validates registration and signs in with the returned parent session", async () => {
    const app = { globalData: { session: null } };
    global.getApp = () => app;
    const page = loadPage();
    page.setData({
      mode: "register",
      username: "bad username",
      password: "123456",
      confirmPassword: "123456",
      agreementAccepted: true
    });

    await page.submit();
    assert.match(page.data.error, /用户名需为/);
    assert.equal(requestCalls.length, 0);

    nextRequestResponse = {
      statusCode: 201,
      data: { user: { id: "p1", username: "new.parent", role: "parent" }, token: "parent-token" }
    };
    page.setData({ username: " new.parent ", displayName: " 新家长 ", error: "" });

    await page.submit();

    assert.deepEqual(requestCalls[0].data, {
      username: "new.parent",
      displayName: "新家长",
      password: "123456"
    });
    assert.equal(storage.get("starbud.childSession").token, "parent-token");
    assert.deepEqual(toastCalls[0], { title: "注册成功", icon: "success" });
    assert.deepEqual(navigationCalls.at(-1), ["switchTab", { url: "/pages/tasks/index" }]);
  });
});
