const api = require("../../services/api");
const { formatSubmittedAt, localDateKey } = require("../../utils/date");
const { getSession } = require("../../utils/storage");

const PAGE_SIZE = 20;

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
    submissions: [],
    totalCount: 0,
    keyword: "",
    loading: true,
    refreshing: false,
    loadingMore: false,
    page: 0,
    hasMore: false,
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
      const result = await api.getSubmissionPage({
        page: 1,
        pageSize: PAGE_SIZE,
        date: this.data.activeFilter === "today" ? localDateKey() : "",
        keyword: this.data.keyword
      });
      this.setData({
        submissions: result.submissions.map(submissionViewModel),
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
    this.loadSubmissions();
  },

  clearSearch() {
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
        date: this.data.activeFilter === "today" ? localDateKey() : "",
        keyword: this.data.keyword
      });
      this.setData({
        submissions: [...this.data.submissions, ...result.submissions.map(submissionViewModel)],
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
  }
});
