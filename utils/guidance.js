function stepState(active, done) {
  return done ? "done" : active ? "active" : "upcoming";
}

function buildTaskGuidance(task) {
  if (!task) return { title: "查看任务安排", description: "先确认任务内容和提醒时间。", steps: [] };

  const completed = task.status === "completed" || task.reviewStatus === "completed" || Boolean(task.finalizedAt);
  const waiting = task.reviewStatus === "pending_review" || (task.submissionStatus === "submitted" && !task.needsRevision && !completed);
  const revising = Boolean(task.needsRevision);
  const claimed = Boolean(task.claimedAt) || waiting || revising || completed;
  const executionDone = waiting || completed;
  const secondLabel = task.requiresPhotoUpload ? "完成并提交" : "确认完成";

  const steps = [
    { key: "claim", label: "领取任务", state: stepState(!claimed, claimed) },
    { key: "execute", label: revising ? "修改并重交" : secondLabel, state: stepState(claimed && !executionDone, executionDone) },
    { key: "review", label: task.requiresPhotoUpload ? "查看批改" : "完成任务", state: stepState(waiting, completed) }
  ];

  if (completed) {
    return { title: "任务已经完成", description: "可以查看提交和批改记录，回顾这次做得顺利的地方。", steps };
  }
  if (revising) {
    return { title: "按批改内容修改", description: "先查看上一轮批改，再重新提交照片或录音。", steps };
  }
  if (waiting) {
    return { title: "等待家长批改", description: "附件已经提交，不需要重复操作，可以先做下一件事。", steps };
  }
  if (!claimed) {
    return { title: "先领取这个任务", description: "确认任务内容后点击领取，再开始执行。", steps };
  }
  if (task.requiresPhotoUpload) {
    return { title: "完成后提交附件", description: "照片或录音至少提交一种，确认无误后再提交。", steps };
  }
  return { title: "完成后点击确认", description: "做完任务后点击下方按钮，记录本次完成。", steps };
}

module.exports = { buildTaskGuidance };
