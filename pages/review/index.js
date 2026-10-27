const api = require("../../services/api");
const { getSession } = require("../../utils/storage");

const MAX_FEEDBACK_LENGTH = 500;
const PAGE_SIZE = 20;

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function reviewItemViewModel(submission) {
  const rounds = submission.reviewRounds || [];
  return {
    id: submission.id,
    taskId: submission.taskId,
    taskDate: submission.taskDate,
    taskTitle: submission.taskTitle,
    childName: submission.childName || "孩子",
    note: submission.note || "",
    submittedLabel: String(submission.submittedAt || "").slice(5, 16),
    photoUrls: (submission.photos || []).map((photo) => photo.url),
    audioUrl: submission.audio ? submission.audio.url : "",
    audioDuration: submission.audio ? formatDuration(submission.audio.durationMs) : "",
    roundLabel: rounds.length ? `第 ${rounds.length + 1} 次提交` : "首次提交"
  };
}

/** 文字评价是“要求修改”的必填内容；“通过并完成”不需要评价。 */
function validateFeedback(value) {
  const feedback = String(value || "").trim();
  if (!feedback) return { ok: false, message: "请先写下需要修改的地方" };
  if (feedback.length > MAX_FEEDBACK_LENGTH) return { ok: false, message: `评价不能超过 ${MAX_FEEDBACK_LENGTH} 个字` };
  return { ok: true, feedback };
}

Page({
  data: {
    items: [],
    total: 0,
    page: 1,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: "",
    activeId: "",
    feedback: "",
    savingId: "",
    playingId: ""
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || session.user.role !== "parent") {
      wx.showModal({
        title: "无法批改",
        content: "只有家长账号可以批改作业。",
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }
    this.load();
  },

  onHide() {
    this.stopAudio();
  },

  onUnload() {
    this.stopAudio();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    return this.loadMore();
  },

  async load() {
    this.reviewLoadVersion = (this.reviewLoadVersion || 0) + 1;
    const version = this.reviewLoadVersion;
    this.setData({ loading: !this.data.items.length, error: "" });
    try {
      const page = await api.getPendingReviews({ page: 1, pageSize: PAGE_SIZE });
      if (version !== this.reviewLoadVersion) return;
      this.setData({
        items: page.submissions.map(reviewItemViewModel),
        total: page.pagination ? page.pagination.total : page.submissions.length,
        page: 1,
        hasMore: Boolean(page.pagination && page.pagination.hasMore)
      });
    } catch (error) {
      if (version === this.reviewLoadVersion) this.setData({ error: error.message || "待批改作业加载失败。" });
    } finally {
      if (version === this.reviewLoadVersion) this.setData({ loading: false });
    }
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const version = this.reviewLoadVersion;
    this.setData({ loadingMore: true });
    try {
      const page = await api.getPendingReviews({ page: this.data.page + 1, pageSize: PAGE_SIZE });
      if (version !== this.reviewLoadVersion) return;
      const seen = new Set(this.data.items.map((item) => item.id));
      this.setData({
        items: [...this.data.items, ...page.submissions.map(reviewItemViewModel).filter((item) => !seen.has(item.id))],
        page: page.pagination ? page.pagination.page : this.data.page + 1,
        hasMore: Boolean(page.pagination && page.pagination.hasMore),
        total: page.pagination ? page.pagination.total : this.data.total
      });
    } catch (error) {
      if (version === this.reviewLoadVersion) wx.showToast({ title: error.message || "加载更多作业失败", icon: "none" });
    } finally {
      if (version === this.reviewLoadVersion) this.setData({ loadingMore: false });
    }
  },

  previewPhoto(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    wx.previewImage({ current: event.currentTarget.dataset.url, urls: item.photoUrls });
  },

  toggleAudio(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item || !item.audioUrl) return;
    if (this.data.playingId === item.id) {
      this.stopAudio();
      return;
    }
    this.stopAudio();
    const player = wx.createInnerAudioContext();
    player.obeyMuteSwitch = false;
    player.src = item.audioUrl;
    player.onEnded(() => this.stopAudio());
    player.onError(() => {
      this.stopAudio();
      wx.showToast({ title: "录音播放失败", icon: "none" });
    });
    this.audioPlayer = player;
    this.setData({ playingId: item.id });
    player.play();
  },

  stopAudio() {
    if (this.audioPlayer) {
      this.audioPlayer.destroy();
      this.audioPlayer = null;
    }
    if (this.data.playingId) this.setData({ playingId: "" });
  },

  openFeedback(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ activeId: this.data.activeId === id ? "" : id, feedback: "" });
  },

  onFeedbackInput(event) {
    this.setData({ feedback: event.detail.value });
  },

  async requestRevision(event) {
    const id = event.currentTarget.dataset.id;
    const result = validateFeedback(this.data.feedback);
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: "none" });
      return;
    }
    await this.runAction(id, () => api.submitCommentReview(id, result.feedback), "已发送给孩子修改");
  },

  approve(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.items.find((entry) => entry.id === id);
    if (!item) return;
    wx.showModal({
      title: "通过并完成？",
      content: `确认「${item.taskTitle}」已完成，孩子将获得本次任务积分。`,
      confirmText: "通过",
      confirmColor: "#0AA868",
      success: (choice) => {
        if (choice.confirm) this.runAction(id, () => api.finalizeSubmissionReview(id), "已通过并完成");
      }
    });
  },

  async runAction(id, action, successTitle) {
    if (this.data.savingId) return;
    this.setData({ savingId: id });
    try {
      await action();
      if (this.data.playingId === id) this.stopAudio();
      const items = this.data.items.filter((entry) => entry.id !== id);
      this.setData({ items, total: Math.max(0, this.data.total - 1), activeId: "", feedback: "" });
      getApp().globalData.taskDataDirty = true;
      wx.showToast({ title: successTitle, icon: "success" });
      // 操作会改变服务端分页位置，重新从第一页读取，避免下一页按偏移量跳过一条。
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败，请重试", icon: "none" });
    } finally {
      this.setData({ savingId: "" });
    }
  }
});

module.exports = { reviewItemViewModel, validateFeedback };
