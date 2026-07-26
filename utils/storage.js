const sessionKey = "starbud.childSession";
const selectedTaskKey = "starbud.selectedTask";

function getSession() {
  return wx.getStorageSync(sessionKey) || null;
}

function setSession(session) {
  wx.setStorageSync(sessionKey, session);
  getApp().globalData.session = session;
}

function clearSession() {
  wx.removeStorageSync(sessionKey);
  wx.removeStorageSync(selectedTaskKey);
  getApp().globalData.session = null;
}

function setSelectedTask(task) {
  wx.setStorageSync(selectedTaskKey, task);
}

function getSelectedTask() {
  return wx.getStorageSync(selectedTaskKey) || null;
}

function clearSelectedTask() {
  wx.removeStorageSync(selectedTaskKey);
}

module.exports = {
  clearSelectedTask,
  clearSession,
  getSelectedTask,
  getSession,
  setSelectedTask,
  setSession
};
