const api = require("../../services/api");
const { friendlyDate } = require("../../utils/date");
const { getSession, setSelectedTask } = require("../../utils/storage");

function taskViewModel(task) {
  const completed = task.status === "completed" || task.submissionStatus === "submitted";
  return {
    ...task,
    completed,
    actionText: completed ? "已提交" : task.claimedAt ? "去完成" : "领取",
    subjectMark: task.title.slice(0, 1),
    description: task.voiceContent || "按时完成任务并拍照提交"
  };
}

Page({
  data: {
    user: null,
    dateLabel: friendlyDate(),
    tasks: [],
    completedCount: 0,
    progressPercent: 0,
    loading: true,
    error: ""
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || session.user.role !== "child") {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ user: session.user });
    this.loadTasks();
  },

  async onPullDownRefresh() {
    await this.loadTasks();
    wx.stopPullDownRefresh();
  },

  async loadTasks() {
    this.setData({ loading: true, error: "" });
    try {
      const tasks = (await api.getTodayTasks()).map(taskViewModel);
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

  async handleTaskAction(event) {
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
  }
});
