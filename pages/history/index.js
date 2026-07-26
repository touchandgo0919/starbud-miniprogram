const api = require("../../services/api");
const { formatSubmittedAt, localDateKey } = require("../../utils/date");
const { getSession } = require("../../utils/storage");

function submissionViewModel(submission) {
  return {
    ...submission,
    submittedLabel: formatSubmittedAt(submission.submittedAt),
    subjectMark: submission.taskTitle.slice(0, 1),
    isToday: submission.taskDate === localDateKey()
  };
}

Page({
  data: {
    activeFilter: "today",
    filters: [
      { value: "all", label: "全部" },
      { value: "today", label: "今日" }
    ],
    allSubmissions: [],
    submissions: [],
    keyword: "",
    loading: true,
    refreshing: false,
    error: ""
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadSubmissions();
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
    this.setData({ loading: true, error: "" });
    try {
      const allSubmissions = (await api.getSubmissions()).map(submissionViewModel);
      this.setData({ allSubmissions });
      this.applyFilter(this.data.activeFilter);
    } catch (error) {
      this.setData({ error: error.message || "提交记录加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectFilter(event) {
    this.applyFilter(event.currentTarget.dataset.value);
  },

  onSearchInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    this.applyFilter(this.data.activeFilter, keyword);
  },

  clearSearch() {
    this.setData({ keyword: "" });
    this.applyFilter(this.data.activeFilter, "");
  },

  applyFilter(activeFilter, keyword = this.data.keyword) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const submissions = this.data.allSubmissions.filter((submission) => {
      const matchesDate = activeFilter !== "today" || submission.isToday;
      const matchesKeyword = !normalizedKeyword
        || submission.taskTitle.toLowerCase().includes(normalizedKeyword);
      return matchesDate && matchesKeyword;
    });
    this.setData({ activeFilter, submissions });
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
  }
});
