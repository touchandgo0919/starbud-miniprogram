const api = require("../../services/api");
const { friendlyDate, localDateKey } = require("../../utils/date");
const { getSession, setSelectedTask } = require("../../utils/storage");

const PAGE_SIZE = 5;
const REVIEW_NOTIFICATION_INTERVAL = 10000;

function taskDateRange(filter) {
  const today = new Date();
  const dateTo = localDateKey(today);

  if (filter === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { dateFrom: localDateKey(start), dateTo };
  }

  if (filter === "month") {
    return { dateFrom: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), dateTo };
  }

  return {};
}

function taskViewModel(task) {
  const completed = task.status === "completed";
  const reviewed = Boolean(task.reviewedAt);
  const waitingReview = task.submissionStatus === "submitted" && !task.finalizedAt && !task.needsRevision;
  const actionText = task.needsRevision ? "待修改" : waitingReview ? "待批改" : completed ? "已完成" : reviewed ? "已批改" : task.claimedAt ? "去完成" : "领取";
  return {
    ...task,
    completed,
    reviewed,
    waitingReview,
    actionText,
    actionClass: completed
      ? "task-control task-control--done"
      : reviewed || waitingReview || task.needsRevision
        ? "task-control task-control--reviewed"
        : task.claimedAt
          ? "task-control task-control--complete"
          : "task-control task-control--claim",
    subjectMark: task.title.slice(0, 1),
    description: task.voiceContent || "按时完成任务并拍照提交"
  };
}

function filterTasks(tasks, keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  return normalized ? tasks.filter((task) => task.title.toLowerCase().includes(normalized)) : tasks;
}

Page({
  data: {
    user: null,
    isParent: false,
    statusBarHeight: 24,
    navBarHeight: 68,
    dateLabel: friendlyDate(),
    filters: [
      { value: "all", label: "全部" },
      { value: "month", label: "本月" },
      { value: "week", label: "本周" },
      { value: "today", label: "今日" }
    ],
    activeFilter: "today",
    keyword: "",
    allTasks: [],
    tasks: [],
    totalCount: 0,
    completedCount: 0,
    progressPercent: 0,
    loading: true,
    refreshing: false,
    loadingMore: false,
    page: 0,
    hasMore: false,
    error: ""
  },

  onLoad() {
    const system = wx.getSystemInfoSync();
    const statusBarHeight = system.statusBarHeight || 24;
    this.setData({ statusBarHeight, navBarHeight: statusBarHeight + 44 });
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ user: session.user, isParent: session.user.role === "parent" });
    if (!this.hasLoadedTasks) {
      this.hasLoadedTasks = true;
      this.loadTasks();
    }
    this.startReviewNotificationPolling();
  },

  onHide() {
    this.stopReviewNotificationPolling();
  },

  onUnload() {
    this.stopReviewNotificationPolling();
  },

  startReviewNotificationPolling() {
    if (this.data.isParent || this.reviewNotificationTimer) return;
    this.checkReviewNotifications();
    this.reviewNotificationTimer = setInterval(() => this.checkReviewNotifications(), REVIEW_NOTIFICATION_INTERVAL);
  },

  stopReviewNotificationPolling() {
    if (!this.reviewNotificationTimer) return;
    clearInterval(this.reviewNotificationTimer);
    this.reviewNotificationTimer = null;
  },

  async checkReviewNotifications() {
    if (this.checkingReviewNotifications) return;
    this.checkingReviewNotifications = true;
    try {
      const notifications = await api.getNotifications();
      const notification = notifications.find((item) => item.type === "review_completed" && !item.readAt);
      if (!notification) return;
      await api.markNotificationRead(notification.id);
      wx.showModal({
        title: notification.title,
        content: notification.content,
        showCancel: false,
        confirmText: "知道了"
      });
    } catch (_) {
      // 通知轮询失败不影响孩子继续查看和完成任务。
    } finally {
      this.checkingReviewNotifications = false;
    }
  },

  async onPullDownRefresh() {
    await this.loadTasks();
    wx.stopPullDownRefresh();
  },

  async onTaskRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await this.loadTasks();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  async loadTasks() {
    this.setData({ loading: true, error: "" });
    try {
      const isToday = this.data.activeFilter === "today";
      const result = isToday ? null : await api.getTaskPage({
        page: 1,
        pageSize: PAGE_SIZE,
        scope: this.data.activeFilter === "all" ? "definitions" : "",
        ...taskDateRange(this.data.activeFilter)
      });
      const sourceTasks = isToday ? await api.getTodayTasks() : result.tasks;
      const allTasks = sourceTasks.map(taskViewModel);
      const tasks = filterTasks(allTasks, this.data.keyword);
      const completedCount = tasks.filter((task) => task.completed).length;
      const totalCount = isToday ? tasks.length : result.pagination.total;
      this.setData({
        tasks,
        allTasks,
        totalCount,
        completedCount,
        progressPercent: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0,
        page: isToday ? 1 : result.pagination.page,
        hasMore: !isToday && result.pagination.hasMore,
        loadingMore: false
      });
    } catch (error) {
      this.setData({ error: error.message || "任务加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onSearchInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword, tasks: filterTasks(this.data.allTasks, keyword) });
  },

  clearSearch() {
    this.setData({ keyword: "", tasks: this.data.allTasks });
  },

  selectFilter(event) {
    const activeFilter = event.currentTarget.dataset.value;
    if (activeFilter === this.data.activeFilter) return;
    this.setData({ activeFilter });
    this.loadTasks();
  },

  async loadMoreTasks() {
    if (this.data.activeFilter === "today" || this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    this.setData({ loadingMore: true });
    try {
      const result = await api.getTaskPage({
        page: this.data.page + 1,
        pageSize: PAGE_SIZE,
        scope: this.data.activeFilter === "all" ? "definitions" : "",
        ...taskDateRange(this.data.activeFilter)
      });
      const additionalTasks = result.tasks.map(taskViewModel);
      const allTasks = [...this.data.allTasks, ...additionalTasks];
      const tasks = filterTasks(allTasks, this.data.keyword);
      const completedCount = tasks.filter((task) => task.completed).length;
      this.setData({
        tasks,
        allTasks,
        completedCount,
        progressPercent: tasks.length
          ? Math.round((completedCount / tasks.length) * 100)
          : 0,
        page: result.pagination.page,
        hasMore: result.pagination.hasMore
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载更多任务失败", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  async handleTaskAction(event) {
    if (this.data.isParent) return;

    const taskId = event.currentTarget.dataset.id;
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task || task.completed || task.waitingReview) return;

    if (!task.claimedAt) {
      try {
        await api.claimTask(task.id);
        wx.showToast({ title: "任务已领取", icon: "success" });
        await this.loadTasks();
      } catch (error) {
        wx.showToast({ title: error.message || "领取失败", icon: "none" });
      }
      return;
    }

    setSelectedTask(task);
    wx.navigateTo({ url: `/pages/submit/index?taskId=${encodeURIComponent(task.id)}` });
  },

  handleTaskDetail(event) {
    const taskId = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => String(item.id) === taskId);
    if (!task) return;

    setSelectedTask(task);
    wx.navigateTo({ url: `/pages/task-detail/index?taskId=${encodeURIComponent(task.id)}` });
  },

  async editTask(event) {
    const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task) return;
    const result = await new Promise((resolve) => wx.showModal({
      title: "编辑任务名称",
      editable: true,
      placeholderText: task.title,
      content: "",
      success: resolve
    }));
    if (!result.confirm || !String(result.content || "").trim()) return;
    try {
      await api.updateTask(task.id, { ...task, title: String(result.content).trim() });
      wx.showToast({ title: "任务已更新", icon: "success" });
      this.loadTasks();
    } catch (error) {
      wx.showToast({ title: error.message || "编辑失败", icon: "none" });
    }
  },

  async deleteTask(event) {
    const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task) return;
    const result = await new Promise((resolve) => wx.showModal({ title: "删除任务", content: `确定删除“${task.title}”吗？`, success: resolve }));
    if (!result.confirm) return;
    try {
      await api.deleteTask(task.id);
      wx.showToast({ title: "任务已删除", icon: "success" });
      this.loadTasks();
    } catch (error) {
      wx.showToast({ title: error.message || "删除失败", icon: "none" });
    }
  },

  async remindTask(event) {
    try {
      await api.remindTask(event.currentTarget.dataset.id);
      wx.showToast({ title: "已发起语音提醒", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "提醒失败", icon: "none" });
    }
  }
});
