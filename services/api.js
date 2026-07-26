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

async function getSubmissions() {
  const body = await request("/api/submissions");
  return body.submissions.map((submission) => ({
    ...submission,
    photos: submission.photos.map((photo) => ({
      ...photo,
      url: absoluteUrl(photo.url)
    }))
  }));
}

module.exports = {
  claimTask,
  createSubmission,
  finalizeSubmission,
  getSubmissions,
  getTasks,
  getTodayTasks,
  login,
  uploadSubmissionPhoto
};
