const { getSession } = require("./utils/storage");

App({
  globalData: {
    session: null,
    submissionDataDirty: false,
    taskDataDirty: false
  },

  onLaunch() {
    this.globalData.session = getSession();
  },
});
