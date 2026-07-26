const api = require("../../services/api");
const { friendlyDate } = require("../../utils/date");
const { getSession, setSelectedTask } = require("../../utils/storage");

const PAGE_SIZE = 20;

function taskViewModel(task) {
  const completed = task.status === "completed" || task.submissionStatus === "submitted";
  const actionText = completed ? "已提交" : task.claimedAt ? "去完成" : "领取";
  return {
    ...task,
    completed,
    actionText,
    actionClass: completed
      ? "task-control task-control--done"
      : task.claimedAt
        ? "task-control task-control--complete"
        : "task-control task-control--claim",
    subjectMark: task.title.slice(0, 1),
    description: task.voiceContent || "按时完成任务并拍照提交"
  };
}

Page({
  data: {
    user: null,
    isParent: false,
    dateLabel: friendlyDate(),
    filters: [
      { value: "all", label: "全部" },
      { value: "today", label: "今日" }
    ],
    activeFilter: "today",
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

  onShow() {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ user: session.user, isParent: session.user.role === "parent" });
    this.loadTasks();
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
      const isAll = this.data.activeFilter === "all";
      const result = isAll ? await api.getTaskPage(1, PAGE_SIZE) : null;
      const sourceTasks = isAll ? result.tasks : await api.getTodayTasks();
      const tasks = sourceTasks.map(taskViewModel);
      const completedCount = tasks.filter((task) => task.completed).length;
      const totalCount = isAll ? result.pagination.total : tasks.length;
      this.setData({
        tasks,
        totalCount,
        completedCount,
        progressPercent: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0,
        page: isAll ? result.pagination.page : 1,
        hasMore: isAll && result.pagination.hasMore,
        loadingMore: false
      });
    } catch (error) {
      this.setData({ error: error.message || "任务加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectFilter(event) {
    const activeFilter = event.currentTarget.dataset.value;
    if (activeFilter === this.data.activeFilter) return;
    this.setData({ activeFilter });
    this.loadTasks();
  },

  async loadMoreTasks() {
    if (this.data.activeFilter !== "all" || this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    this.setData({ loadingMore: true });
    try {
      const result = await api.getTaskPage(this.data.page + 1, PAGE_SIZE);
      const additionalTasks = result.tasks.map(taskViewModel);
      const tasks = [...this.data.tasks, ...additionalTasks];
      const completedCount = tasks.filter((task) => task.completed).length;
      this.setData({
        tasks,
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
    if (!task || task.completed) return;

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
  }
});
