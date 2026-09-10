const api = require("../../services/api");
const { getSession } = require("../../utils/storage");
const { localDateKey } = require("../../utils/date");

const repeatOptions = [
  { value: "once", label: "仅一次" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" }
];

Page({
  data: {
    title: "",
    children: [],
    targetMode: "self",
    selectedChildIds: [],
    date: localDateKey(),
    endDate: "",
    time: "20:00",
    repeatIndex: 0,
    repeatLabels: repeatOptions.map((item) => item.label),
    requiresPhotoUpload: true,
    voiceEnabled: true,
    voiceReminderCountIndex: 0,
    voiceReminderCounts: [1, 2, 3],
    claimReminderEnabled: false,
    revisionReminderEnabled: false,
    voiceContent: "",
    saving: false
  },

  async onLoad() {
    const session = getSession();
    if (!session || session.user?.role !== "parent") {
      wx.showToast({ title: "仅家长可以创建任务", icon: "none" });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }
    try {
      const children = await api.getChildren();
      this.setData({ children: children.map((child) => ({ ...child, selected: false })) });
    } catch (error) {
      wx.showToast({ title: error.message || "加载任务对象失败", icon: "none" });
    }
  },

  onTitleInput(event) { this.setData({ title: event.detail.value }); },
  onVoiceInput(event) { this.setData({ voiceContent: event.detail.value }); },
  chooseTargetMode(event) {
    const targetMode = event.currentTarget.dataset.mode;
    this.setData({
      targetMode,
      requiresPhotoUpload: targetMode === "self" ? false : this.data.requiresPhotoUpload,
      claimReminderEnabled: targetMode === "self" ? false : this.data.claimReminderEnabled,
      revisionReminderEnabled: targetMode === "self" ? false : this.data.revisionReminderEnabled
    });
  },
  onChildrenChange(event) {
    const selectedChildIds = event.detail.value || [];
    this.setData({
      selectedChildIds,
      children: this.data.children.map((child) => ({ ...child, selected: selectedChildIds.includes(child.id) }))
    });
  },
  onDateChange(event) { this.setData({ date: event.detail.value }); },
  onEndDateChange(event) { this.setData({ endDate: event.detail.value }); },
  onTimeChange(event) { this.setData({ time: event.detail.value }); },
  onRepeatChange(event) { this.setData({ repeatIndex: Number(event.detail.value) }); },
  onAttachmentSwitch(event) {
    const requiresPhotoUpload = Boolean(event.detail.value);
    this.setData({ requiresPhotoUpload, revisionReminderEnabled: requiresPhotoUpload ? this.data.revisionReminderEnabled : false });
  },
  onVoiceSwitch(event) { this.setData({ voiceEnabled: Boolean(event.detail.value) }); },
  onVoiceReminderCountChange(event) { this.setData({ voiceReminderCountIndex: Number(event.detail.value) }); },
  onClaimReminderSwitch(event) { this.setData({ claimReminderEnabled: Boolean(event.detail.value) }); },
  onRevisionReminderSwitch(event) { this.setData({ revisionReminderEnabled: Boolean(event.detail.value) }); },

  async submit() {
    if (this.data.saving) return;
    const title = this.data.title.trim();
    if (!title) {
      wx.showToast({ title: "请填写任务名称", icon: "none" });
      return;
    }
    const personalTodo = this.data.targetMode === "self";
    const childIds = this.data.selectedChildIds;
    if (!personalTodo && !childIds.length) {
      wx.showToast({ title: "请至少选择一位儿童", icon: "none" });
      return;
    }
    if (this.data.endDate && this.data.endDate < this.data.date) {
      wx.showToast({ title: "截止日期不能早于执行日期", icon: "none" });
      return;
    }
    const repeatType = repeatOptions[this.data.repeatIndex].value;
    const taskPayload = {
      title,
      startDate: this.data.date,
      endDate: repeatType === "once" ? null : (this.data.endDate || null),
      scheduleTime: this.data.time,
      repeatType,
      voiceEnabled: this.data.voiceEnabled,
      voiceContent: this.data.voiceContent.trim() || title,
      voiceReminderCount: this.data.voiceReminderCounts[this.data.voiceReminderCountIndex],
      requiresPhotoUpload: personalTodo ? false : this.data.requiresPhotoUpload,
      claimReminderEnabled: personalTodo || !this.data.voiceEnabled ? false : this.data.claimReminderEnabled,
      revisionReminderEnabled: personalTodo || !this.data.requiresPhotoUpload ? false : this.data.revisionReminderEnabled
    };
    this.setData({ saving: true });
    try {
      const results = await Promise.allSettled(
        personalTodo
          ? [api.createTask({ ...taskPayload, targetType: "self" })]
          : childIds.map((childId) => api.createTask({ ...taskPayload, targetType: "child", childId }))
      );
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      if (!successCount) throw new Error("创建失败，请稍后重试");
      getApp().globalData.taskDataDirty = true;
      wx.showToast({ title: personalTodo ? "待办已创建" : `已创建 ${successCount} 项任务`, icon: "success" });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (error) {
      wx.showToast({ title: error.message || "创建失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});
