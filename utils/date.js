const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function pad(value) {
  return String(value).padStart(2, "0");
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function friendlyDate(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
}

function formatSubmittedAt(value) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(String(value));
  return match ? `${match[2]}-${match[3]} ${match[4]}` : String(value);
}

module.exports = {
  formatSubmittedAt,
  friendlyDate,
  localDateKey
};
