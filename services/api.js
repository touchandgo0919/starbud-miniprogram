const { absoluteUrl, request, upload } = require("../utils/request");

async function login(username, password) {
  return request("/api/auth/login", {
    method: "POST",
    data: { username, password }
  });
}

async function getTodayTasks() {
  const body = await request("/api/tasks/today");
  return body.tasks;
}

async function getTasks() {
  const body = await request("/api/tasks");
  return body.tasks;
}

async function getTaskPage({ page, pageSize, dateFrom, dateTo, scope }) {
  const params = [`page=${page}`, `pageSize=${pageSize}`];
  if (dateFrom) params.push(`dateFrom=${encodeURIComponent(dateFrom)}`);
  if (dateTo) params.push(`dateTo=${encodeURIComponent(dateTo)}`);
  if (scope) params.push(`scope=${encodeURIComponent(scope)}`);
  const body = await request(`/api/tasks?${params.join("&")}`);
  return body;
}

async function getTask(taskId) {
  const body = await request(`/api/tasks/${taskId}`);
  return body.task;
}

async function claimTask(taskId) {
  const body = await request(`/api/tasks/${taskId}/claim`, { method: "POST" });
  return body.task;
}

async function createSubmission(taskId, note) {
  const body = await request(`/api/tasks/${taskId}/submissions`, {
    method: "POST",
    data: { note }
  });
  return body.submission;
}

async function uploadSubmissionPhoto(submissionId, filePath) {
  const body = await upload(`/api/submissions/${submissionId}/photos`, filePath);
  return body.photo;
}

async function finalizeSubmission(submissionId) {
  const body = await request(`/api/submissions/${submissionId}/submit`, {
    method: "POST"
  });
  return body.submission;
}

async function updateSubmissionNote(submissionId, note) {
  const body = await request(`/api/submissions/${submissionId}`, {
    method: "PATCH",
    data: { note }
  });
  return body.submission;
}

async function reopenSubmissionForResubmit(submissionId) {
  const body = await request(`/api/submissions/${submissionId}/resubmit`, { method: "POST" });
  return body.submission;
}

async function getSubmissions() {
  const body = await request("/api/submissions");
  return body.submissions.map(normalizeSubmissionUrls);
}

function normalizeSubmissionUrls(submission) {
  return {
    ...submission,
    photos: submission.photos.map((photo) => ({ ...photo, url: absoluteUrl(photo.url) })),
    reviewImageUrl: submission.reviewImageUrl ? absoluteUrl(submission.reviewImageUrl) : "",
    reviewRounds: (submission.reviewRounds || []).map((round) => ({
      ...round,
      reviewImageUrl: absoluteUrl(round.reviewImageUrl),
      photos: round.photos.map((photo) => ({ ...photo, url: absoluteUrl(photo.url) })),
      photoUrls: round.photos.map((photo) => absoluteUrl(photo.url))
    }))
  };
}

async function getTaskSubmission(taskId, date) {
  const body = await request(`/api/tasks/${taskId}/submission?date=${encodeURIComponent(date)}`);
  return normalizeSubmissionUrls(body.submission);
}

async function getSubmissionPage({ page, pageSize, date, dateFrom, dateTo, keyword }) {
  const params = [`page=${page}`, `pageSize=${pageSize}`];
  if (date) params.push(`date=${encodeURIComponent(date)}`);
  if (dateFrom) params.push(`dateFrom=${encodeURIComponent(dateFrom)}`);
  if (dateTo) params.push(`dateTo=${encodeURIComponent(dateTo)}`);
  if (keyword && keyword.trim()) params.push(`keyword=${encodeURIComponent(keyword.trim())}`);
  const body = await request(`/api/submissions?${params.join("&")}`);
  return {
    submissions: body.submissions.map(normalizeSubmissionUrls),
    pagination: body.pagination
  };
}

async function getNotifications() {
  const body = await request("/api/notifications");
  return body.notifications;
}

async function markNotificationRead(notificationId) {
  return request(`/api/notifications/${notificationId}/read`, { method: "POST" });
}

async function updateTask(taskId, data) {
  const body = await request(`/api/tasks/${taskId}`, { method: "PATCH", data });
  return body.task;
}

async function deleteTask(taskId) {
  return request(`/api/tasks/${taskId}`, { method: "DELETE" });
}

async function remindTask(taskId) {
  const body = await request(`/api/tasks/${taskId}/remind`, { method: "POST" });
  return body.task;
}

module.exports = {
  claimTask,
  createSubmission,
  finalizeSubmission,
  getNotifications,
  getSubmissions,
  getTaskSubmission,
  getSubmissionPage,
  getTasks,
  getTask,
  getTaskPage,
  getTodayTasks,
  updateTask,
  deleteTask,
  remindTask,
  login,
  markNotificationRead,
  uploadSubmissionPhoto,
  updateSubmissionNote,
  reopenSubmissionForResubmit
};
