function useSpeakerOutput() {
  return new Promise((resolve) => {
    if (typeof wx.setInnerAudioOption !== "function") {
      resolve(true);
      return;
    }

    try {
      wx.setInnerAudioOption({
        speakerOn: true,
        obeyMuteSwitch: false,
        mixWithOther: false,
        success: () => resolve(true),
        fail: (error) => {
          console.warn("切换扬声器播放失败", error);
          resolve(false);
        }
      });
    } catch (error) {
      console.warn("切换扬声器播放失败", error);
      resolve(false);
    }
  });
}

module.exports = { useSpeakerOutput };
