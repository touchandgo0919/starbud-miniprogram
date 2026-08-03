const api = require("../../services/api");
const {
  clearSelectedTask,
  getSelectedTask,
  getSession,
  setSelectedTask
} = require("../../utils/storage");
const { localDateKey } = require("../../utils/date");

Page({
  data: {
    task: null,
    photos: [],
    existingPhotos: [],
    audio: null,
    existingAudio: null,
    recording: false,
    recordingDuration: 0,
    audioDurationLabel: "",
    note: "",
    resubmitSubmissionId: "",
    reopenOnSubmit: false,
    recoveredDraft: false,
    submitting: false,
    uploadProgress: ""
  },

  async onLoad(options) {
    this.setupRecorder();
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
    const resubmitSubmissionId = String(options.submissionId || "");
    const reopenOnSubmit = options.resubmit === "1";
    const selectedTask = getSelectedTask();
    if (selectedTask && String(selectedTask.id) === taskId) {
      this.setData({
        task: {
          ...selectedTask,
          subjectMark: selectedTask.subjectMark || selectedTask.title.slice(0, 1)
        },
        resubmitSubmissionId,
        reopenOnSubmit
      });
      await this.restoreExistingDraft(selectedTask, resubmitSubmissionId);
      return;
    }

    try {
      const task = await api.getTask(taskId, String(options.taskDate || ""), "submit");
      if (!task) throw new Error("任务不存在或今天无需执行。");
      const taskView = {
        ...task,
        subjectMark: task.title.slice(0, 1)
      };
      setSelectedTask(taskView);
      this.setData({ task: taskView, resubmitSubmissionId, reopenOnSubmit });
      await this.restoreExistingDraft(taskView, resubmitSubmissionId);
    } catch (error) {
      wx.showModal({
        title: "无法打开任务",
        content: error.message || "任务加载失败。",
        showCancel: false,
        success: () => wx.navigateBack()
      });
    }
  },

  async restoreExistingDraft(task, resubmitSubmissionId) {
    if (resubmitSubmissionId) return;
    try {
      const submission = await api.getTaskSubmission(
        task.id,
        task.occurrenceDate || localDateKey(new Date())
      );
      if (submission.status !== "draft" || (!submission.photos.length && !submission.audio)) return;
      this.setData({
        resubmitSubmissionId: submission.id,
        existingPhotos: submission.photos,
        existingAudio: submission.audio,
        audioDurationLabel: submission.audio ? this.formatAudioDuration(Math.round(submission.audio.durationMs / 1_000)) : "",
        note: submission.note || "",
        recoveredDraft: true
      });
    } catch (error) {
      // 首次提交没有草稿时接口会返回 404，保持空白提交页即可。
      if (!String(error && error.message || "").includes("404")) console.warn("恢复提交草稿失败", error);
    }
  },

  onUnload() {
    if (this.recordingTimer) clearInterval(this.recordingTimer);
    this.audioPlayer?.destroy();
  },

  setupRecorder() {
    this.recorder = wx.getRecorderManager();
    this.recorder.onStart(() => {
      this.recordingStartedAt = Date.now();
      this.setData({ recording: true, recordingDuration: 0 });
      this.recordingTimer = setInterval(() => {
        this.setData({ recordingDuration: Math.floor((Date.now() - this.recordingStartedAt) / 1000) });
      }, 1_000);
    });
    this.recorder.onStop((result) => {
      if (this.recordingTimer) clearInterval(this.recordingTimer);
      this.recordingTimer = null;
      const duration = Math.max(1, Math.round((result.duration || Date.now() - this.recordingStartedAt) / 1_000));
      this.setData({
        audio: { path: result.tempFilePath, duration },
        recording: false,
        recordingDuration: duration,
        audioDurationLabel: this.formatAudioDuration(duration)
      });
    });
    this.recorder.onError(() => {
      if (this.recordingTimer) clearInterval(this.recordingTimer);
      this.recordingTimer = null;
      this.setData({ recording: false });
      wx.showToast({ title: "录音失败，请检查麦克风权限", icon: "none" });
    });
  },

  startRecording() {
    if (this.data.recording) return;
    this.recorder.start({
      duration: 180_000,
      sampleRate: 16_000,
      numberOfChannels: 1,
      encodeBitRate: 48_000,
      format: "mp3"
    });
  },

  stopRecording() {
    if (this.data.recording) this.recorder.stop();
  },

  async deleteAudio() {
    if (this.data.audio) {
      this.setData({ audio: null, recordingDuration: 0, audioDurationLabel: this.data.existingAudio ? this.formatAudioDuration(Math.round(this.data.existingAudio.durationMs / 1_000)) : "" });
      return;
    }
    if (!this.data.existingAudio || !this.data.resubmitSubmissionId) return;
    try {
      await api.deleteSubmissionAudio(this.data.resubmitSubmissionId);
      this.setData({ existingAudio: null, audioDurationLabel: "" });
    } catch (error) {
      wx.showToast({ title: error.message || "录音删除失败", icon: "none" });
    }
  },

  formatAudioDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  },

  playAudio() {
    const source = this.data.audio?.path || this.data.existingAudio?.url;
    if (!source) return;
    this.audioPlayer?.destroy();
    this.audioPlayer = wx.createInnerAudioContext();
    this.audioPlayer.src = source;
    this.audioPlayer.play();
  },

  choosePhotos() {
    const remaining = 8 - this.data.existingPhotos.length - this.data.photos.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多上传 8 张照片", icon: "none" });
      return;
    }

    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (result) => {
        const photos = await Promise.all(result.tempFiles.map(async (file) => ({
          path: await this.compressPhoto(file.tempFilePath),
          size: file.size
        })));
        this.setData({ photos: [...this.data.photos, ...photos] });
      }
    });
  },

  compressPhoto(path) {
    return new Promise((resolve) => {
      wx.compressImage({
        src: path,
        quality: 75,
        success: (result) => resolve(result.tempFilePath),
        // 部分格式或较小文件无需压缩，保留原文件以确保提交不中断。
        fail: () => resolve(path)
      });
    });
  },

  previewPhoto(event) {
    const current = event.currentTarget.dataset.path;
    wx.previewImage({
      current,
      urls: this.data.photos.map((photo) => photo.path)
    });
  },

  previewExistingPhoto(event) {
    const current = event.currentTarget.dataset.url;
    wx.previewImage({
      current,
      urls: this.data.existingPhotos.map((photo) => photo.url)
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
    const hasAttachment = this.data.existingPhotos.length + this.data.photos.length > 0 || this.data.audio || this.data.existingAudio;
    if (!hasAttachment) {
      wx.showToast({ title: "请提交照片或录音", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认提交作业？",
      content: this.data.existingPhotos.length || this.data.existingAudio
        ? `已恢复 ${this.data.existingPhotos.length} 张照片${this.data.photos.length ? `，将补传 ${this.data.photos.length} 张` : ""}，确认提交吗？`
        : `将上传 ${this.data.photos.length} 张照片${this.data.audio ? "和 1 段录音" : ""}，确认提交吗？`,
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
      const submission = this.data.reopenOnSubmit
        ? await api.reopenSubmissionForResubmit(this.data.resubmitSubmissionId)
        : this.data.resubmitSubmissionId
          ? { id: this.data.resubmitSubmissionId, status: "draft" }
          : await api.createSubmission(this.data.task.id, this.data.note, this.data.task.occurrenceDate);
      if (submission.status !== "submitted") {
        if (this.data.resubmitSubmissionId) {
          await api.updateSubmissionNote(submission.id, this.data.note);
        }
        for (let index = 0; index < this.data.photos.length; index += 1) {
          this.setData({
            uploadProgress: `正在上传第 ${index + 1} / ${this.data.photos.length} 张照片…`
          });
          await api.uploadSubmissionPhoto(submission.id, this.data.photos[index].path);
        }
        if (this.data.audio) {
          this.setData({ uploadProgress: "正在上传录音…" });
          await api.uploadSubmissionAudio(submission.id, this.data.audio.path, this.data.audio.duration * 1_000);
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
