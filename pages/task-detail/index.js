const api = require("../../services/api");
const { useSpeakerOutput } = require("../../utils/audio");
const { buildTaskGuidance } = require("../../utils/guidance");
const { getSelectedTask, getSession, setSelectedTask } = require("../../utils/storage");

const repeatLabels = {
  once: "仅一次",
  daily: "每天",
  weekdays: "工作日",
  weekly: "每周"
};

function formatAudioDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function submissionViewModel(submission) {
  const withPlayback = (audio, fallbackKey) => audio ? {
    ...audio,
    playbackKey: String(audio.id || fallbackKey),
    durationLabel: formatAudioDuration(Number(audio.durationMs || 0) / 1_000)
  } : null;

  return {
    ...submission,
    audio: withPlayback(submission.audio, `${submission.id}-audio`),
    reviewRounds: (submission.reviewRounds || []).map((round) => ({
      ...round,
      audios: (round.audios || []).map((audio, index) => withPlayback(audio, `${round.id}-audio-${index}`))
    }))
  };
}

function confirmClaim(taskTitle) {
  return new Promise((resolve) => {
    wx.showModal({
      title: "确认领取",
      content: `确认领取“${taskTitle}”吗？`,
      confirmText: "确认领取",
      cancelText: "取消",
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false)
    });
  });
}

function taskViewModel(task) {
  const needsRevision = Boolean(task.needsRevision);
  const waitingReview = task.submissionStatus === "submitted" && !task.finalizedAt && !needsRevision;
  const completed = task.status === "completed";
  const reviewed = Boolean(task.reviewedAt);
  return {
    ...task,
    completed,
    repeatLabel: repeatLabels[task.repeatType] || "未知",
    statusLabel: needsRevision ? "待修改" : waitingReview ? "待批改" : completed ? "已完成" : reviewed ? "已批改" : "待完成",
    needsRevision,
    waitingReview,
    canChildAct: !completed && !waitingReview && (!reviewed || needsRevision),
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
    guidance: null,
    submission: null,
    isChild: false,
    loading: true,
    playingAudioKey: "",
    loadingAudioKey: "",
    audioPlaybackLabel: ""
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
    const taskDate = String(options.taskDate || (selectedTask && String(selectedTask.id) === taskId ? selectedTask.occurrenceDate || "" : ""));
    this.taskId = taskId;
    this.taskDate = taskDate;

    try {
      await this.loadTaskData();
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

  onShow() {
    if (!this.hasAppeared) {
      this.hasAppeared = true;
      return;
    }
    if (this.taskId && !this.data.loading) this.loadTaskData(true);
  },

  async loadTaskData(silent = false) {
    try {
      const task = await api.getTask(this.taskId, this.taskDate, "detail");
      if (!task) throw new Error("任务不存在或无权查看。");
      const taskView = taskViewModel(task);
      setSelectedTask(taskView);
      await this.loadSubmission(taskView);
      this.setData({ task: taskView, guidance: buildTaskGuidance(taskView) });
    } catch (error) {
      if (!silent) throw error;
      wx.showToast({ title: error.message || "任务状态更新失败", icon: "none" });
    }
  },

  async loadSubmission(task) {
    if (!task.submissionId && !task.submissionStatus) {
      this.setData({ submission: null });
      return;
    }

    const date = task.occurrenceDate || new Date().toLocaleDateString("en-CA");
    try {
      const submission = await api.getTaskSubmission(task.id, date);
      this.setData({ submission: submissionViewModel(submission) });
    } catch (error) {
      const message = String(error.message || "");
      if (!message.includes("404") && !/not found/i.test(message)) throw error;
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

  previewRoundPhoto(event) {
    const value = event.currentTarget.dataset.urls;
    const urls = Array.isArray(value) ? value : String(value || "").split("|").filter(Boolean);
    const current = event.currentTarget.dataset.url;
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  destroyAudioPlayer(updateData = true) {
    this.audioPlayRequested = false;
    this.audioPlayerSource = "";
    if (this.audioPlayer) {
      this.audioPlayer.destroy();
      this.audioPlayer = null;
    }
    if (updateData) {
      this.setData({ playingAudioKey: "", loadingAudioKey: "", audioPlaybackLabel: "" });
    }
  },

  async playRoundAudio(event) {
    const audioKey = String(event.currentTarget.dataset.id || "");
    const source = String(event.currentTarget.dataset.url || "");
    if (!audioKey || !source || this.audioOutputPending) return;
    this.audioOutputPending = true;
    const speakerReady = await useSpeakerOutput();
    this.audioOutputPending = false;
    if (!speakerReady) {
      wx.showToast({ title: "扬声器设置失败，请重试", icon: "none" });
      return;
    }

    if (this.audioPlayer && this.audioPlayerSource === source) {
      if (this.data.playingAudioKey === audioKey) {
        this.audioPlayer.pause();
      } else {
        this.setData({ loadingAudioKey: audioKey });
        this.audioPlayer.play();
      }
      return;
    }

    this.destroyAudioPlayer(false);
    const player = wx.createInnerAudioContext();
    this.audioPlayer = player;
    this.audioPlayerSource = source;
    this.audioPlayRequested = true;
    player.obeyMuteSwitch = false;
    player.volume = 1;
    this.setData({ playingAudioKey: "", loadingAudioKey: audioKey, audioPlaybackLabel: "" });

    player.onCanplay(() => {
      if (this.audioPlayer !== player || !this.audioPlayRequested) return;
      this.audioPlayRequested = false;
      player.play();
    });
    player.onPlay(() => {
      if (this.audioPlayer !== player) return;
      this.setData({
        playingAudioKey: audioKey,
        loadingAudioKey: "",
        audioPlaybackLabel: formatAudioDuration(player.currentTime || 0)
      });
    });
    player.onTimeUpdate(() => {
      if (this.audioPlayer === player) {
        this.setData({ audioPlaybackLabel: formatAudioDuration(player.currentTime || 0) });
      }
    });
    player.onPause(() => {
      if (this.audioPlayer === player) this.setData({ playingAudioKey: "", loadingAudioKey: "" });
    });
    player.onEnded(() => {
      if (this.audioPlayer === player) {
        this.setData({ playingAudioKey: "", loadingAudioKey: "", audioPlaybackLabel: "" });
      }
    });
    player.onWaiting?.(() => {
      if (this.audioPlayer === player) this.setData({ loadingAudioKey: audioKey });
    });
    player.onError(() => {
      if (this.audioPlayer !== player) return;
      this.destroyAudioPlayer();
      wx.showToast({ title: "录音加载失败，请稍后重试", icon: "none" });
    });
    player.src = source;
  },

  onUnload() {
    this.destroyAudioPlayer(false);
  },

  async handlePrimaryAction() {
    const task = this.data.task;
    if (!this.data.isChild || !task) return;

    if (task.needsRevision && this.data.submission && this.data.submission.id) {
      setSelectedTask(task);
      wx.navigateTo({ url: `/pages/submit/index?taskId=${encodeURIComponent(task.id)}&taskDate=${encodeURIComponent(task.occurrenceDate || "")}&submissionId=${encodeURIComponent(this.data.submission.id)}&resubmit=1` });
      return;
    }

    if (task.completed || task.waitingReview) return;

    if (!task.claimedAt) {
      if (!await confirmClaim(task.title)) return;
      try {
        const claimedTask = await api.claimTask(task.id, task.occurrenceDate);
        const taskView = taskViewModel(claimedTask);
        setSelectedTask(taskView);
        this.setData({ task: taskView, guidance: buildTaskGuidance(taskView) });
        wx.showToast({ title: taskView.completed ? "任务已完成" : "任务已领取", icon: "success" });
      } catch (error) {
        wx.showToast({ title: error.message || "领取失败", icon: "none" });
      }
      return;
    }

    if (!task.requiresPhotoUpload) {
      try {
        const completedTask = await api.completeTask(task.id, task.occurrenceDate);
        const taskView = taskViewModel(completedTask);
        setSelectedTask(taskView);
        this.setData({ task: taskView, guidance: buildTaskGuidance(taskView) });
        wx.showToast({ title: "任务已完成", icon: "success" });
      } catch (error) {
        wx.showToast({ title: error.message || "完成失败", icon: "none" });
      }
      return;
    }

    setSelectedTask(task);
    wx.navigateTo({ url: `/pages/submit/index?taskId=${encodeURIComponent(task.id)}&taskDate=${encodeURIComponent(task.occurrenceDate || "")}` });
  }
});
