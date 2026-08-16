const api = require("../../services/api");

Page({
  data: { center: null, loading: true },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true });
    try { this.setData({ center: await api.getRewardCenter() }); }
    catch (error) { wx.showToast({ title: error.message || "加载失败", icon: "none" }); }
    finally { this.setData({ loading: false }); }
  },
  redeem(event) {
    const reward = event.currentTarget.dataset.reward;
    wx.showModal({ title: "申请兑换", editable: true, placeholderText: "想对家长说的话（选填）", content: `用 ${reward.pointCost} 星芽积分兑换「${reward.title}」？`, confirmText: "申请兑换", success: async (result) => {
      if (!result.confirm) return;
      try { await api.requestRewardRedemption(reward.id, result.content || ""); wx.showToast({ title: "已提交给家长确认", icon: "success" }); this.load(); }
      catch (error) { wx.showToast({ title: error.message || "申请失败", icon: "none" }); }
    }});
  }
});
