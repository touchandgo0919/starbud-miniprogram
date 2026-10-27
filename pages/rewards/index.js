const api = require("../../services/api");

// 为每个奖励补充“还差多少分”和进度，并挑出最接近的下一个目标，让孩子知道还需要做什么。
function rewardViewModel(center) {
  if (!center) return center;
  const balance = Number(center.balance) || 0;
  const rewards = (center.rewards || []).filter((reward) => reward.active).map((reward) => {
    const pointCost = Number(reward.pointCost) || 0;
    const shortfall = Math.max(0, pointCost - balance);
    return {
      ...reward,
      affordable: shortfall === 0,
      shortfall,
      progress: pointCost ? Math.min(100, Math.round((balance / pointCost) * 100)) : 100
    };
  });
  const nextGoal = rewards
    .filter((reward) => !reward.affordable)
    .sort((left, right) => left.shortfall - right.shortfall)[0] || null;
  const taskPoints = Number(center.settings && center.settings.taskPoints) || 0;
  return {
    ...center,
    rewards,
    nextGoal: nextGoal
      ? { title: nextGoal.title, shortfall: nextGoal.shortfall, tasksNeeded: taskPoints ? Math.ceil(nextGoal.shortfall / taskPoints) : 0 }
      : null
  };
}

module.exports = { rewardViewModel };

Page({
  data: { center: null, loading: true },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true });
    try { this.setData({ center: rewardViewModel(await api.getRewardCenter()) }); }
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
