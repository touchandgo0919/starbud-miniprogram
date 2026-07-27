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
  const reviewed = Boolean(task.reviewedAt);
  return {
    ...task,
    completed,
    repeatLabel: repeatLabels[task.repeatType] || "未知",
    statusLabel: reviewed ? "已批改" : completed ? "已完成" : "待完成",
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
    submission: null,
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
      await this.loadSubmission(taskViewModel(selectedTask));
      this.setData({ task: taskViewModel(selectedTask), loading: false });
      return;
    }

    try {
      const task = await api.getTask(taskId);
      if (!task) throw new Error("任务不存在或无权查看。");
      const taskView = taskViewModel(task);
      setSelectedTask(taskView);
      await this.loadSubmission(taskView);
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

  async loadSubmission(task) {
    const date = task.occurrenceDate || new Date().toLocaleDateString("en-CA");
    try {
      const submission = await api.getTaskSubmission(task.id, date);
      this.setData({ submission });
    } catch (error) {
      if (!String(error.message || "").includes("404")) throw error;
      this.setData({ submission: null });
    }
  },

  previewReviewedPhoto() {
    const url = this.data.submission && this.data.submission.reviewImageUrl;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },

  previewOriginalPhotos() {
    const photos = this.data.submission && this.data.submission.photos;
    if (photos && photos.length) wx.previewImage({ current: photos[0].url, urls: photos.map((photo) => photo.url) });
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
