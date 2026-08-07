const api = require("../../services/api");
const { buildSharePayload } = require("../../utils/share");
const { getSession } = require("../../utils/storage");

function formatDate(dateKey) {
  const date = dateKey ? new Date(`${dateKey}T00:00:00`) : new Date();
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`;
}

function stageLabel(stage, source) {
  if (stage === "revise") return "批改后待修改";
  if (stage === "waiting") return "等待家长批改";
  if (stage === "continue") return source === "model" ? "建议下一步" : "继续进行";
  if (stage === "claim") return source === "model" ? "建议下一步" : "现在可以开始";
  if (stage === "complete") return "今日已完成";
  return "今日安排";
}

function viewModel(home) {
  const nextStep = home.nextStep || {};
  return {
    ...home,
    dateLabel: formatDate(home.date),
    nextStep: {
      ...nextStep,
      stageLabel: stageLabel(nextStep.stage, nextStep.source),
      hasTask: Boolean(nextStep.taskId)
    }
  };
}

Page({
  data: {
    user: null,
    statusBarHeight: 24,
    navBarHeight: 68,
    home: null,
    loading: true,
    refreshing: false,
    error: ""
  },

  onLoad() {
    const system = wx.getSystemInfoSync();
    const statusBarHeight = system.statusBarHeight || 24;
    this.setData({ statusBarHeight, navBarHeight: statusBarHeight + 44 });
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    if (session.user.role === "parent") {
      wx.switchTab({ url: "/pages/tasks/index" });
      return;
    }
    this.setData({ user: session.user });
    this.loadHome();
  },

  onShareAppMessage() {
    return buildSharePayload("今天从下一步开始", "/pages/home/index");
  },

  onShareTimeline() {
    return buildSharePayload("今天从下一步开始");
  },

  async loadHome() {
    this.setData({ loading: !this.data.home, error: "" });
    try {
      this.setData({ home: viewModel(await api.getChildHome()) });
    } catch (error) {
      this.setData({ error: error.message || "首页加载失败。" });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    await this.loadHome();
    wx.stopPullDownRefresh();
  },

  openNextStep() {
    const nextStep = this.data.home && this.data.home.nextStep;
    if (!nextStep || !nextStep.taskId) {
      wx.switchTab({ url: "/pages/tasks/index" });
      return;
    }
    wx.navigateTo({
      url: `/pages/task-detail/index?taskId=${encodeURIComponent(nextStep.taskId)}&taskDate=${encodeURIComponent(nextStep.taskDate || "")}`
    });
  },

  async openAttention(event) {
    const item = this.data.home.attention.find((attention) => attention.notificationId === event.currentTarget.dataset.id);
    if (!item) return;
    try {
      await api.markNotificationRead(item.notificationId);
    } catch (_) {
      // 标记失败不阻止孩子查看批改结果。
    }
    wx.navigateTo({
      url: `/pages/task-detail/index?taskId=${encodeURIComponent(item.taskId)}&taskDate=${encodeURIComponent(item.taskDate || "")}`
    });
  },

  openTasks() {
    wx.switchTab({ url: "/pages/tasks/index" });
  }
});

module.exports = { formatDate, stageLabel, viewModel };
