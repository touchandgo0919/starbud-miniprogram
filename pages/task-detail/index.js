const api = require("../../services/api");
const { getSelectedTask, getSession, setSelectedTask } = require("../../utils/storage");

const repeatLabels = {
  once: "仅一次",
  daily: "每天",
  weekdays: "工作日",
  weekly: "每周"
};

function taskViewModel(task) {
  const completed = task.status === "completed" || task.submissionStatus === "submitted";
  return {
    ...task,
    completed,
    repeatLabel: repeatLabels[task.repeatType] || "未知",
    statusLabel: completed ? "已完成" : "待完成",
    claimLabel: task.claimedAt ? "已领取" : "未领取",
    submissionLabel: task.submissionStatus === "submitted"
      ? `已提交（${task.submissionPhotoCount || 0} 张照片）`
      : task.submissionStatus === "draft" ? "提交中" : "未提交",
    voiceLabel: task.voiceEnabled ? `语音提醒 ${task.voiceReminderCount || 1} 次` : "静默提醒",
    subjectMark: task.title.slice(0, 1)
  };
}

Page({
  data: {
    task: null,
    isChild: false,
    loading: true
  },

  async onLoad(options) {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }

    const taskId = String(options.taskId || "");
    this.setData({ isChild: session.user.role === "child" });
    const selectedTask = getSelectedTask();
    if (selectedTask && String(selectedTask.id) === taskId) {
      this.setData({ task: taskViewModel(selectedTask), loading: false });
      return;
    }

    try {
      const task = (await api.getTodayTasks()).find((item) => String(item.id) === taskId);
      if (!task) throw new Error("任务不存在或今天无需执行。");
      const taskView = taskViewModel(task);
      setSelectedTask(taskView);
      this.setData({ task: taskView });
    } catch (error) {
      wx.showModal({
        title: "无法打开任务",
        content: error.message || "任务加载失败。",
        showCancel: false,
        success: () => wx.navigateBack()
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async handlePrimaryAction() {
    const task = this.data.task;
    if (!this.data.isChild || !task || task.completed) return;

    if (!task.claimedAt) {
      try {
        const claimedTask = await api.claimTask(task.id);
        const taskView = taskViewModel(claimedTask);
        setSelectedTask(taskView);
        this.setData({ task: taskView });
        wx.showToast({ title: "任务已领取", icon: "success" });
      } catch (error) {
        wx.showToast({ title: error.message || "领取失败", icon: "none" });
      }
      return;
    }

    setSelectedTask(task);
    wx.navigateTo({ url: `/pages/submit/index?taskId=${encodeURIComponent(task.id)}` });
  }
});
