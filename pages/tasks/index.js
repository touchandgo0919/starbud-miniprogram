const api = require("../../services/api");
const { friendlyDate } = require("../../utils/date");
const { getSession, setSelectedTask } = require("../../utils/storage");

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
    completedCount: 0,
    progressPercent: 0,
    loading: true,
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

  async loadTasks() {
    this.setData({ loading: true, error: "" });
    try {
      const sourceTasks = this.data.activeFilter === "today"
        ? await api.getTodayTasks()
        : await api.getTasks();
      const tasks = sourceTasks.map(taskViewModel);
      const completedCount = tasks.filter((task) => task.completed).length;
      this.setData({
        tasks,
        completedCount,
        progressPercent: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0
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
