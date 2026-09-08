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
    targets: [{ id: "self", name: "我（待办）", self: true }],
    targetIndex: 0,
    targetNames: ["我（待办）"],
    date: localDateKey(),
    time: "20:00",
    repeatIndex: 0,
    repeatLabels: repeatOptions.map((item) => item.label),
    voiceEnabled: true,
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
      const targets = [{ id: "self", name: "我（待办）", self: true }, ...children.map((child) => ({ ...child, self: false }))];
      this.setData({ targets, targetNames: targets.map((target) => target.name) });
    } catch (error) {
      wx.showToast({ title: error.message || "加载任务对象失败", icon: "none" });
    }
  },

  onTitleInput(event) { this.setData({ title: event.detail.value }); },
  onVoiceInput(event) { this.setData({ voiceContent: event.detail.value }); },
  onTargetChange(event) { this.setData({ targetIndex: Number(event.detail.value) }); },
  onDateChange(event) { this.setData({ date: event.detail.value }); },
  onTimeChange(event) { this.setData({ time: event.detail.value }); },
  onRepeatChange(event) { this.setData({ repeatIndex: Number(event.detail.value) }); },
  onVoiceSwitch(event) { this.setData({ voiceEnabled: Boolean(event.detail.value) }); },

  async submit() {
    if (this.data.saving) return;
    const title = this.data.title.trim();
    const target = this.data.targets[this.data.targetIndex];
    if (!title) {
      wx.showToast({ title: "请填写任务名称", icon: "none" });
      return;
    }
    if (!target) return;
    const personalTodo = Boolean(target.self);
    this.setData({ saving: true });
    try {
      await api.createTask({
        title,
        targetType: personalTodo ? "self" : "child",
        childId: personalTodo ? undefined : target.id,
        startDate: this.data.date,
        scheduleTime: this.data.time,
        repeatType: repeatOptions[this.data.repeatIndex].value,
        voiceEnabled: this.data.voiceEnabled,
        voiceContent: this.data.voiceContent.trim() || title,
        voiceReminderCount: 1,
        requiresPhotoUpload: personalTodo ? false : true,
        claimReminderEnabled: false,
        revisionReminderEnabled: false
      });
      getApp().globalData.taskDataDirty = true;
      wx.showToast({ title: "任务已创建", icon: "success" });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (error) {
      wx.showToast({ title: error.message || "创建失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});
