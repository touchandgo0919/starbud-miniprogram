const api = require("../../services/api");
const { localDateKey } = require("../../utils/date");
const { buildSharePayload } = require("../../utils/share");
const { getSession } = require("../../utils/storage");
const REMINDER_NOTIFICATION_INTERVAL = 10000;

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

function parentTaskViewModel(task) {
  const completed = task.status === "completed" || task.reviewStatus === "completed" || Boolean(task.finalizedAt);
  const waitingReview = task.reviewStatus === "pending_review";
  if (completed || waitingReview) return null;
  const reminderType = task.needsRevision ? "revision" : task.claimedAt ? "complete" : "claim";
  const state = reminderType === "revision"
    ? { label: "待修改", description: "已批改，等待孩子修改后重新提交", actionLabel: "催改", priority: 0 }
    : reminderType === "claim"
      ? { label: "待领取", description: "还没有领取，可以提醒孩子开始", actionLabel: "催领", priority: 1 }
      : { label: "进行中", description: task.submissionStatus === "draft" ? "附件还在准备中，尚未提交" : "已经领取，尚未完成提交", actionLabel: "催完成", priority: 2 };
  return {
    ...task,
    ...state,
    reminderType,
    subjectMark: task.title.slice(0, 1),
    childName: task.childName || "家庭成员"
  };
}

function parentHomeViewModel(tasks, date = localDateKey()) {
  const pendingTasks = tasks
    .map(parentTaskViewModel)
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority || left.scheduleTime.localeCompare(right.scheduleTime));
  return {
    date,
    dateLabel: formatDate(date),
    pendingTasks,
    total: pendingTasks.length,
    childCount: new Set(pendingTasks.map((task) => task.childId)).size,
    counts: {
      claim: pendingTasks.filter((task) => task.reminderType === "claim").length,
      complete: pendingTasks.filter((task) => task.reminderType === "complete").length,
      revision: pendingTasks.filter((task) => task.reminderType === "revision").length
    }
  };
}

Page({
  data: {
    user: null,
    statusBarHeight: 24,
    navBarHeight: 68,
    isParent: false,
    home: null,
    parentHome: null,
    remindingTaskId: "",
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
    const isParent = session.user.role === "parent";
    this.setData({ user: session.user, isParent });
    if (isParent) this.loadParentHome();
    else {
      this.loadHome();
      this.startReminderNotificationPolling();
    }
  },

  onHide() {
    this.stopReminderNotificationPolling();
  },

  onUnload() {
    this.stopReminderNotificationPolling();
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

  async loadParentHome() {
    this.setData({ loading: !this.data.parentHome, error: "" });
    try {
      this.setData({ parentHome: parentHomeViewModel(await api.getTodayTasks()) });
    } catch (error) {
      this.setData({ error: error.message || "首页加载失败。" });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  startReminderNotificationPolling() {
    if (this.reminderNotificationTimer) return;
    this.checkReminderNotifications();
    this.reminderNotificationTimer = setInterval(() => this.checkReminderNotifications(), REMINDER_NOTIFICATION_INTERVAL);
  },

  stopReminderNotificationPolling() {
    if (!this.reminderNotificationTimer) return;
    clearInterval(this.reminderNotificationTimer);
    this.reminderNotificationTimer = null;
  },

  async checkReminderNotifications() {
    if (this.checkingReminderNotifications) return;
    this.checkingReminderNotifications = true;
    try {
      const notifications = await api.getNotifications();
      const notification = notifications.find((item) => ["claim_reminder", "revision_reminder", "voice_reminder"].includes(item.type) && !item.readAt);
      if (!notification) return;
      await api.markNotificationRead(notification.id);
      await this.loadHome();
      wx.showModal({ title: notification.title, content: notification.content, showCancel: false, confirmText: "知道了" });
    } catch (_) {
      // 提醒轮询失败不影响首页任务展示。
    } finally {
      this.checkingReminderNotifications = false;
    }
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    if (this.data.isParent) await this.loadParentHome();
    else await this.loadHome();
    wx.stopPullDownRefresh();
  },

  retryHome() {
    if (this.data.isParent) return this.loadParentHome();
    return this.loadHome();
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
  },

  openParentTask(event) {
    const task = this.data.parentHome && this.data.parentHome.pendingTasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task) return;
    wx.navigateTo({
      url: `/pages/task-detail/index?taskId=${encodeURIComponent(task.id)}&taskDate=${encodeURIComponent(task.occurrenceDate || "")}`
    });
  },

  async remindParentTask(event) {
    const task = this.data.parentHome && this.data.parentHome.pendingTasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task || this.data.remindingTaskId) return;
    this.setData({ remindingTaskId: task.id });
    try {
      await api.remindTask(task.id, task.occurrenceDate, task.reminderType);
      wx.showToast({ title: `${task.actionLabel}提醒已发送`, icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "提醒失败", icon: "none" });
      await this.loadParentHome();
    } finally {
      this.setData({ remindingTaskId: "" });
    }
  }
});

module.exports = { formatDate, stageLabel, viewModel, parentTaskViewModel, parentHomeViewModel };
