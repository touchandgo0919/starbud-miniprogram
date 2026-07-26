const api = require("../../services/api");
const {
  clearSelectedTask,
  getSelectedTask,
  getSession,
  setSelectedTask
} = require("../../utils/storage");

Page({
  data: {
    task: null,
    photos: [],
    note: "",
    submitting: false,
    uploadProgress: ""
  },

  async onLoad(options) {
    const session = getSession();
    if (!session || !session.user || session.user.role !== "child") {
      wx.showModal({
        title: "无法提交作业",
        content: "只有儿童账号可以拍照提交作业。",
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }

    const taskId = String(options.taskId || "");
    const selectedTask = getSelectedTask();
    if (selectedTask && String(selectedTask.id) === taskId) {
      this.setData({
        task: {
          ...selectedTask,
          subjectMark: selectedTask.subjectMark || selectedTask.title.slice(0, 1)
        }
      });
      return;
    }

    try {
      const task = (await api.getTodayTasks()).find((item) => String(item.id) === taskId);
      if (!task) throw new Error("任务不存在或今天无需执行。");
      const taskView = {
        ...task,
        subjectMark: task.title.slice(0, 1)
      };
      setSelectedTask(taskView);
      this.setData({ task: taskView });
    } catch (error) {
      wx.showModal({
        title: "无法打开任务",
        content: error.message || "任务加载失败。",
        showCancel: false,
        success: () => wx.navigateBack()
      });
    }
  },

  choosePhotos() {
    const remaining = 6 - this.data.photos.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多上传 6 张照片", icon: "none" });
      return;
    }

    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (result) => {
        const photos = result.tempFiles.map((file) => ({
          path: file.tempFilePath,
          size: file.size
        }));
        this.setData({ photos: [...this.data.photos, ...photos] });
      }
    });
  },

  previewPhoto(event) {
    const current = event.currentTarget.dataset.path;
    wx.previewImage({
      current,
      urls: this.data.photos.map((photo) => photo.path)
    });
  },

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      photos: this.data.photos.filter((_, photoIndex) => photoIndex !== index)
    });
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  submit() {
    if (!this.data.task || this.data.submitting) return;
    if (!this.data.photos.length) {
      wx.showToast({ title: "请至少上传一张作业照片", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认提交作业？",
      content: `将上传 ${this.data.photos.length} 张照片，提交后不能继续添加。`,
      confirmText: "确认提交",
      confirmColor: "#0AA868",
      success: (result) => {
        if (result.confirm) this.performSubmit();
      }
    });
  },

  async performSubmit() {
    this.setData({ submitting: true, uploadProgress: "正在创建提交单…" });
    try {
      const submission = await api.createSubmission(this.data.task.id, this.data.note);
      if (submission.status !== "submitted") {
        for (let index = 0; index < this.data.photos.length; index += 1) {
          this.setData({
            uploadProgress: `正在上传第 ${index + 1} / ${this.data.photos.length} 张照片…`
          });
          await api.uploadSubmissionPhoto(submission.id, this.data.photos[index].path);
        }
        this.setData({ uploadProgress: "正在确认提交…" });
        await api.finalizeSubmission(submission.id);
      }

      clearSelectedTask();
      wx.showToast({ title: "作业已提交", icon: "success", duration: 1200 });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/history/index" });
      }, 1200);
    } catch (error) {
      wx.showModal({
        title: "提交失败",
        content: error.message || "请检查网络后重试。",
        showCancel: false
      });
    } finally {
      this.setData({ submitting: false, uploadProgress: "" });
    }
  }
});
