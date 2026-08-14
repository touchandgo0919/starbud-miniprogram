const api = require("../../services/api");
const { useSpeakerOutput } = require("../../utils/audio");
const { formatSubmittedAt, localDateKey } = require("../../utils/date");
const { buildSharePayload } = require("../../utils/share");
const { getSession } = require("../../utils/storage");

const PAGE_SIZE = 20;

function formatAudioDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function submissionDateRange(filter) {
  const today = new Date();
  const dateTo = localDateKey(today);

  if (filter === "today") return { date: dateTo };

  if (filter === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    return { dateFrom: localDateKey(start), dateTo };
  }

  if (filter === "month") {
    return { dateFrom: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), dateTo };
  }

  return {};
}

function submissionViewModel(submission, showChildName) {
  return {
    ...submission,
    submittedLabel: [showChildName && submission.childName, formatSubmittedAt(submission.submittedAt)]
      .filter(Boolean)
      .join(" · "),
    subjectMark: submission.taskTitle.slice(0, 1),
    reviewed: Boolean(submission.reviewedAt),
    statusLabel: submission.finalizedAt ? "已完成" : submission.reviewedAt ? "已批改" : "已提交",
    statusClass: submission.finalizedAt ? "history-status--completed" : "",
    audio: submission.audio ? {
      ...submission.audio,
      durationLabel: formatAudioDuration(Number(submission.audio.durationMs || 0) / 1_000)
    } : null,
    canEditNote: !submission.finalizedAt
  };
}

Page({
  data: {
    statusBarHeight: 24,
    navBarHeight: 68,
    activeFilter: "today",
    filters: [
      { value: "all", label: "全部" },
      { value: "month", label: "本月" },
      { value: "week", label: "本周" },
      { value: "today", label: "今日" }
    ],
    submissions: [],
    playingAudioId: "",
    loadingAudioId: "",
    audioPlaybackLabel: "",
    isParent: false,
    editingSubmissionId: "",
    editingNote: "",
    totalCount: 0,
    keyword: "",
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
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },

  onShareAppMessage() {
    return buildSharePayload("我的提交", "/pages/history/index");
  },

  onShareTimeline() {
    return buildSharePayload("我的提交");
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ isParent: session.user.role === "parent" });
    const app = getApp();
    const submissionDataDirty = Boolean(app.globalData.submissionDataDirty);
    app.globalData.submissionDataDirty = false;
    if (!this.hasLoadedSubmissions || submissionDataDirty) {
      this.hasLoadedSubmissions = true;
      this.loadSubmissions();
    }
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.destroyAudioPlayer(false);
  },

  async onPullDownRefresh() {
    await this.loadSubmissions();
    wx.stopPullDownRefresh();
  },

  async onHistoryRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await this.loadSubmissions();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  async loadSubmissions() {
    this.destroyAudioPlayer();
    this.setData({ loading: true, error: "" });
    try {
      const result = await api.getSubmissionPage({
        page: 1,
        pageSize: PAGE_SIZE,
        ...submissionDateRange(this.data.activeFilter),
        keyword: this.data.keyword
      });
      this.setData({
        submissions: result.submissions.map((submission) => submissionViewModel(submission, this.data.isParent)),
        totalCount: result.pagination.total,
        page: result.pagination.page,
        hasMore: result.pagination.hasMore,
        loadingMore: false
      });
    } catch (error) {
      this.setData({ error: error.message || "提交记录加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectFilter(event) {
    const activeFilter = event.currentTarget.dataset.value;
    if (activeFilter === this.data.activeFilter) return;
    this.setData({ activeFilter });
    this.loadSubmissions();
  },

  onSearchInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.loadSubmissions();
    }, 350);
  },

  clearSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.setData({ keyword: "" });
    this.loadSubmissions();
  },

  async loadMoreSubmissions() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;

    this.setData({ loadingMore: true });
    try {
      const result = await api.getSubmissionPage({
        page: this.data.page + 1,
        pageSize: PAGE_SIZE,
        ...submissionDateRange(this.data.activeFilter),
        keyword: this.data.keyword
      });
      this.setData({
        submissions: [...this.data.submissions, ...result.submissions.map((submission) => submissionViewModel(submission, this.data.isParent))],
        page: result.pagination.page,
        hasMore: result.pagination.hasMore
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载更多记录失败", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  previewPhoto(event) {
    const submissionId = event.currentTarget.dataset.submission;
    const current = event.currentTarget.dataset.url;
    const submission = this.data.submissions.find((item) => item.id === submissionId);
    if (!submission) return;
    wx.previewImage({
      current,
      urls: submission.photos.map((photo) => photo.url)
    });
  },

  destroyAudioPlayer(updateData = true) {
    this.audioPlayRequested = false;
    this.audioPlayerSource = "";
    if (this.audioPlayer) {
      this.audioPlayer.destroy();
      this.audioPlayer = null;
    }
    if (updateData) {
      this.setData({ playingAudioId: "", loadingAudioId: "", audioPlaybackLabel: "" });
    }
  },

  async playAudio(event) {
    const submissionId = String(event.currentTarget.dataset.id || "");
    const source = String(event.currentTarget.dataset.url || "");
    if (!submissionId || !source || this.audioOutputPending) return;

    this.audioOutputPending = true;
    const speakerReady = await useSpeakerOutput();
    this.audioOutputPending = false;
    if (!speakerReady) {
      wx.showToast({ title: "扬声器设置失败，请重试", icon: "none" });
      return;
    }

    if (this.audioPlayer && this.audioPlayerSource === source) {
      if (this.data.playingAudioId === submissionId) {
        this.audioPlayer.pause();
      } else {
        this.setData({ loadingAudioId: submissionId });
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
    this.setData({ playingAudioId: "", loadingAudioId: submissionId, audioPlaybackLabel: "" });

    player.onCanplay(() => {
      if (this.audioPlayer !== player || !this.audioPlayRequested) return;
      this.audioPlayRequested = false;
      player.play();
    });
    player.onPlay(() => {
      if (this.audioPlayer !== player) return;
      this.setData({
        playingAudioId: submissionId,
        loadingAudioId: "",
        audioPlaybackLabel: formatAudioDuration(player.currentTime || 0)
      });
    });
    player.onTimeUpdate(() => {
      if (this.audioPlayer === player) {
        this.setData({ audioPlaybackLabel: formatAudioDuration(player.currentTime || 0) });
      }
    });
    player.onPause(() => {
      if (this.audioPlayer === player) this.setData({ playingAudioId: "", loadingAudioId: "" });
    });
    player.onEnded(() => {
      if (this.audioPlayer === player) {
        this.setData({ playingAudioId: "", loadingAudioId: "", audioPlaybackLabel: "" });
      }
    });
    player.onWaiting?.(() => {
      if (this.audioPlayer === player) this.setData({ loadingAudioId: submissionId });
    });
    player.onError(() => {
      if (this.audioPlayer !== player) return;
      this.destroyAudioPlayer();
      wx.showToast({ title: "录音加载失败，请稍后重试", icon: "none" });
    });
    player.src = source;
  },

  startEditNote(event) {
    const submissionId = event.currentTarget.dataset.id;
    const submission = this.data.submissions.find((item) => item.id === submissionId);
    if (!submission) return;
    if (!submission.canEditNote) {
      wx.showToast({ title: "任务已完成，备注不可编辑", icon: "none" });
      return;
    }
    this.setData({ editingSubmissionId: submissionId, editingNote: submission.note || "" });
  },

  onNoteInput(event) {
    this.setData({ editingNote: event.detail.value });
  },

  cancelEditNote() {
    this.setData({ editingSubmissionId: "", editingNote: "" });
  },

  async saveNote() {
    const submissionId = this.data.editingSubmissionId;
    if (!submissionId) return;
    const submission = this.data.submissions.find((item) => item.id === submissionId);
    if (!submission || !submission.canEditNote) {
      this.cancelEditNote();
      wx.showToast({ title: "任务已完成，备注不可编辑", icon: "none" });
      return;
    }
    try {
      const updated = await api.updateSubmissionNote(submissionId, this.data.editingNote);
      this.setData({
        submissions: this.data.submissions.map((item) => item.id === submissionId ? { ...item, note: updated.note } : item),
        editingSubmissionId: "",
        editingNote: ""
      });
      wx.showToast({ title: "备注已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "备注保存失败", icon: "none" });
    }
  }
});
