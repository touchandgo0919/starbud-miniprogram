Component({
  properties: {
    taskId: { type: String, value: "" },
    reminderType: { type: String, value: "claim" },
    label: { type: String, value: "催领" },
    loading: { type: Boolean, value: false }
  },

  methods: {
    handleTap() {
      if (this.data.loading) return;
      this.triggerEvent("remind", { taskId: this.data.taskId });
    }
  }
});
