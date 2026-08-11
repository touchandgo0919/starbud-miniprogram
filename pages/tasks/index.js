const api = require("../../services/api");
const { localDateKey } = require("../../utils/date");
const { buildSharePayload } = require("../../utils/share");
const { getSession, setSelectedTask } = require("../../utils/storage");

const PAGE_SIZE = 20;
const REVIEW_NOTIFICATION_INTERVAL = 10000;
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

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

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, count) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + count);
  return result;
}

function sundayStart(date) {
  return addDays(date, -date.getDay());
}

function buildCalendarDays(selectedDate, expanded, year, month) {
  const selected = dateFromKey(selectedDate);
  const displayMonth = month - 1;
  const selectedInMonth = selected.getFullYear() === year && selected.getMonth() === displayMonth;
  const baseDate = selectedInMonth ? selected : new Date(year, displayMonth, 1);
  const start = expanded
    ? sundayStart(new Date(year, displayMonth, 1))
    : sundayStart(baseDate);
  const length = expanded ? 42 : 7;
  const today = localDateKey();

  return Array.from({ length }, (_, index) => {
    const date = addDays(start, index);
    const key = localDateKey(date);
    return {
      key,
      label: String(date.getDate()),
      isCurrentMonth: date.getFullYear() === year && date.getMonth() === displayMonth,
      isSelected: key === selectedDate,
      isToday: key === today,
      hasTask: false,
      dotClass: ""
    };
  });
}

function taskViewModel(task, showChildName) {
  const completed = task.status === "completed" || task.reviewStatus === "completed" || Boolean(task.finalizedAt);
  const reviewed = Boolean(task.reviewedAt);
  const waitingReview = task.submissionStatus === "submitted" && !task.finalizedAt && !task.needsRevision;
  const parentReminderType = task.needsRevision ? "revision" : task.claimedAt ? "complete" : "claim";
  const canParentRemind = !completed && !waitingReview;
  const actionText = task.needsRevision ? "待修改" : waitingReview ? "待批改" : completed ? "已完成" : reviewed ? "已批改" : task.claimedAt ? "去完成" : "去领取";
  return {
    ...task,
    completed,
    reviewed,
    waitingReview,
    canParentRemind,
    parentReminderType,
    parentReminderLabel: parentReminderType === "revision" ? "催改" : parentReminderType === "claim" ? "催领" : "催完成",
    parentStatusLabel: completed ? "已完成" : waitingReview ? "待批改" : "",
    canChildAct: !completed && !waitingReview && (!reviewed || task.needsRevision),
    actionText,
    actionClass: completed
      ? "task-control task-control--done"
      : waitingReview
        ? "task-control task-control--waiting-review"
        : reviewed || task.needsRevision
        ? "task-control task-control--reviewed"
        : task.claimedAt
          ? "task-control task-control--complete"
          : "task-control task-control--claim",
    subjectMark: task.title.slice(0, 1),
    description: [showChildName && task.childName, task.voiceContent || "按时完成任务并拍照提交"]
      .filter(Boolean)
      .join(" · "),
    dotClass: completed
      ? "task-dot--done"
      : waitingReview
        ? "task-dot--waiting-review"
        : reviewed || task.needsRevision
          ? "task-dot--reviewed"
          : task.claimedAt
            ? "task-dot--complete"
            : "task-dot--claim"
  };
}

Page({
  data: {
    user: null,
    isParent: false,
    statusBarHeight: 24,
    navBarHeight: 68,
    weekdayLabels,
    selectedDate: localDateKey(),
    todayDate: localDateKey(),
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    calendarTitle: "",
    calendarDays: [],
    calendarExpanded: false,
    calendarTaskDates: {},
    tasks: [],
    totalCount: 0,
    completedCount: 0,
    progressPercent: 0,
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
    this.refreshCalendarView();
  },

  onShareAppMessage() {
    return buildSharePayload("我的任务", "/pages/tasks/index");
  },

  onShareTimeline() {
    return buildSharePayload("我的任务");
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ user: session.user, isParent: session.user.role === "parent" });
    this.refreshTaskPage();
    this.startReviewNotificationPolling();
  },

  onHide() {
    this.stopReviewNotificationPolling();
  },

  onUnload() {
    this.stopReviewNotificationPolling();
  },

  refreshCalendarView(taskDates = this.data.calendarTaskDates) {
    const calendarDays = buildCalendarDays(
      this.data.selectedDate,
      this.data.calendarExpanded,
      this.data.calendarYear,
      this.data.calendarMonth
    )
      .map((day) => ({
        ...day,
        hasTask: Boolean(taskDates[day.key]),
        dotClass: taskDates[day.key] ? `calendar-day__dot--${taskDates[day.key]}` : ""
      }));
    this.setData({
      calendarTitle: `${this.data.calendarYear}年${this.data.calendarMonth}月`,
      calendarDays
    });
  },

  async refreshTaskPage() {
    await Promise.all([this.loadTasks(), this.loadCalendarTasks(true)]);
  },

  startReviewNotificationPolling() {
    if (this.data.isParent || this.reviewNotificationTimer) return;
    this.checkReviewNotifications();
    this.reviewNotificationTimer = setInterval(() => this.checkReviewNotifications(), REVIEW_NOTIFICATION_INTERVAL);
  },

  stopReviewNotificationPolling() {
    if (!this.reviewNotificationTimer) return;
    clearInterval(this.reviewNotificationTimer);
    this.reviewNotificationTimer = null;
  },

  async checkReviewNotifications() {
    if (this.checkingReviewNotifications) return;
    this.checkingReviewNotifications = true;
    try {
      const notifications = await api.getNotifications();
      const notification = notifications.find((item) => ["review_completed", "claim_reminder", "revision_reminder", "voice_reminder"].includes(item.type) && !item.readAt);
      if (!notification) return;
      await api.markNotificationRead(notification.id);
      await this.refreshTaskPage();
      wx.showModal({ title: notification.title, content: notification.content, showCancel: false, confirmText: "知道了" });
    } catch (_) {
      // 通知轮询失败不影响孩子继续查看和完成任务。
    } finally {
      this.checkingReviewNotifications = false;
    }
  },

  async onPullDownRefresh() {
    await this.refreshTaskPage();
    wx.stopPullDownRefresh();
  },

  async onTaskRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await this.refreshTaskPage();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  async loadTasks() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await api.getTaskPage({ page: 1, pageSize: PAGE_SIZE, date: this.data.selectedDate });
      const tasks = result.tasks.map((task) => taskViewModel(task, this.data.isParent));
      const completedCount = tasks.filter((task) => task.completed).length;
      this.setData({
        tasks,
        totalCount: result.pagination.total,
        completedCount,
        progressPercent: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0,
        page: result.pagination.page,
        hasMore: result.pagination.hasMore,
        loadingMore: false
      });
    } catch (error) {
      this.setData({ error: error.message || "任务加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadCalendarTasks(force = false) {
    const days = buildCalendarDays(
      this.data.selectedDate,
      this.data.calendarExpanded,
      this.data.calendarYear,
      this.data.calendarMonth
    );
    const dateFrom = days[0].key;
    const dateTo = days[days.length - 1].key;
    const cacheKey = `${dateFrom}:${dateTo}`;
    this.calendarTaskCache = this.calendarTaskCache || {};
    if (!force && this.calendarTaskCache[cacheKey]) {
      const calendarTaskDates = this.calendarTaskCache[cacheKey];
      this.setData({ calendarTaskDates });
      this.refreshCalendarView(calendarTaskDates);
      return;
    }
    const requestId = (this.calendarRequestId || 0) + 1;
    this.calendarRequestId = requestId;
    try {
      const calendarTaskDates = await api.getTaskCalendar(dateFrom, dateTo);
      if (requestId !== this.calendarRequestId) return;
      this.calendarTaskCache[cacheKey] = calendarTaskDates;
      this.setData({ calendarTaskDates });
      this.refreshCalendarView(calendarTaskDates);
    } catch (_) {
      if (requestId !== this.calendarRequestId) return;
      this.refreshCalendarView({});
    }
  },

  selectCalendarDate(event) {
    const selectedDate = event.currentTarget.dataset.date;
    if (!selectedDate || selectedDate === this.data.selectedDate) return;
    const selected = dateFromKey(selectedDate);
    this.setData({
      selectedDate,
      calendarYear: selected.getFullYear(),
      calendarMonth: selected.getMonth() + 1,
      page: 0,
      hasMore: false
    }, () => this.refreshTaskPage());
  },

  toggleCalendar() {
    this.setData({ calendarExpanded: !this.data.calendarExpanded }, () => {
      this.refreshCalendarView();
      this.loadCalendarTasks();
    });
  },

  selectToday() {
    const today = new Date();
    this.setData({
      selectedDate: localDateKey(today),
      calendarYear: today.getFullYear(),
      calendarMonth: today.getMonth() + 1,
      page: 0,
      hasMore: false
    }, () => this.refreshTaskPage());
  },

  shiftCalendarMonth(offset) {
    if (!offset) return;
    const next = new Date(this.data.calendarYear, this.data.calendarMonth - 1 + offset, 1);
    this.setData({
      calendarYear: next.getFullYear(),
      calendarMonth: next.getMonth() + 1,
      calendarExpanded: true
    }, () => {
      this.refreshCalendarView();
      this.loadCalendarTasks();
    });
  },

  changeCalendarMonth(event) {
    this.shiftCalendarMonth(Number(event.currentTarget.dataset.offset));
  },

  onCalendarTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.calendarTouchStart = { x: touch.clientX, y: touch.clientY };
  },

  onCalendarTouchEnd(event) {
    const start = this.calendarTouchStart;
    const touch = event.changedTouches && event.changedTouches[0];
    this.calendarTouchStart = null;
    if (!start || !touch) return;
    const offsetX = touch.clientX - start.x;
    const offsetY = touch.clientY - start.y;
    if (Math.abs(offsetX) < 56 || Math.abs(offsetX) <= Math.abs(offsetY)) return;
    this.shiftCalendarMonth(offsetX < 0 ? 1 : -1);
  },

  showCurrentMonth() {
    const today = new Date();
    this.setData({
      calendarYear: today.getFullYear(),
      calendarMonth: today.getMonth() + 1,
      calendarExpanded: true
    }, () => {
      this.refreshCalendarView();
      this.loadCalendarTasks();
    });
  },

  async loadMoreTasks() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    try {
      const result = await api.getTaskPage({
        page: this.data.page + 1,
        pageSize: PAGE_SIZE,
        date: this.data.selectedDate
      });
      const additionalTasks = result.tasks.map((task) => taskViewModel(task, this.data.isParent));
      const tasks = [...this.data.tasks, ...additionalTasks];
      const completedCount = tasks.filter((task) => task.completed).length;
      this.setData({
        tasks,
        completedCount,
        progressPercent: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0,
        page: result.pagination.page,
        hasMore: result.pagination.hasMore
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载更多任务失败", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  async handleTaskAction(event) {
    if (this.data.isParent) return;
    const taskId = event.currentTarget.dataset.id;
    let task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    try {
      task = taskViewModel(await api.getTask(task.id, task.occurrenceDate, "action"), false);
    } catch (error) {
      wx.showToast({ title: error.message || "任务状态加载失败", icon: "none" });
      return;
    }
    if (task.completed || task.waitingReview) return;
    if (task.needsRevision) {
      setSelectedTask(task);
      wx.navigateTo({ url: `/pages/task-detail/index?taskId=${encodeURIComponent(task.id)}&taskDate=${encodeURIComponent(task.occurrenceDate || "")}` });
      return;
    }
    if (!task.claimedAt) {
      if (!await confirmClaim(task.title)) return;
      try {
        const claimedTask = await api.claimTask(task.id, task.occurrenceDate);
        wx.showToast({ title: claimedTask.status === "completed" ? "任务已完成" : "任务已领取", icon: "success" });
        await this.refreshTaskPage();
      } catch (error) {
        wx.showToast({ title: error.message || "领取失败", icon: "none" });
      }
      return;
    }
    if (!task.requiresPhotoUpload) {
      try {
        await api.completeTask(task.id, task.occurrenceDate);
        wx.showToast({ title: "任务已完成", icon: "success" });
        await this.refreshTaskPage();
      } catch (error) {
        wx.showToast({ title: error.message || "完成失败", icon: "none" });
      }
      return;
    }
    setSelectedTask(task);
    wx.navigateTo({ url: `/pages/submit/index?taskId=${encodeURIComponent(task.id)}&taskDate=${encodeURIComponent(task.occurrenceDate || "")}` });
  },

  handleTaskDetail(event) {
    const taskId = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => String(item.id) === taskId);
    if (!task) return;
    setSelectedTask(task);
    wx.navigateTo({ url: `/pages/task-detail/index?taskId=${encodeURIComponent(task.id)}&taskDate=${encodeURIComponent(task.occurrenceDate || "")}` });
  },

  async editTask(event) {
    const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task) return;
    const result = await new Promise((resolve) => wx.showModal({ title: "编辑任务名称", editable: true, placeholderText: task.title, content: "", success: resolve }));
    if (!result.confirm || !String(result.content || "").trim()) return;
    try {
      await api.updateTask(task.id, { ...task, title: String(result.content).trim() });
      wx.showToast({ title: "任务已更新", icon: "success" });
      this.refreshTaskPage();
    } catch (error) {
      wx.showToast({ title: error.message || "编辑失败", icon: "none" });
    }
  },

  async deleteTask(event) {
    const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task) return;
    const scopes = task.repeatType === "once"
      ? [{ label: "全部任务", value: "all" }]
      : [
        { label: "全部任务", value: "all" },
        { label: "今天及以后未开始的任务", value: "future" },
        { label: "仅删除本次", value: "single" }
      ];
    const selection = await new Promise((resolve) => wx.showActionSheet({ itemList: scopes.map((item) => item.label), success: resolve, fail: resolve }));
    if (selection.cancel || selection.tapIndex === undefined) return;
    const scope = scopes[selection.tapIndex];
    if (!scope) return;
    const result = await new Promise((resolve) => wx.showModal({ title: "删除任务", content: `提交、照片和批改记录会保留。确认${scope.label}吗？`, success: resolve }));
    if (!result.confirm) return;
    try {
      await api.deleteTask(task.id, scope.value, task.occurrenceDate);
      wx.showToast({ title: "任务已删除", icon: "success" });
      this.refreshTaskPage();
    } catch (error) {
      wx.showToast({ title: error.message || "删除失败", icon: "none" });
    }
  },

  async remindTask(event) {
    const task = this.data.tasks.find((item) => item.id === event.currentTarget.dataset.id);
    if (!task || !task.canParentRemind) return;
    try {
      await api.remindTask(task.id, task.occurrenceDate, task.parentReminderType);
      wx.showToast({ title: `${task.parentReminderLabel}提醒已发送`, icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "提醒失败", icon: "none" });
      this.refreshTaskPage();
    }
  }
});
