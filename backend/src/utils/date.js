const dayjs = require("dayjs");

function isValidIsoDate(dateString) {
  return dayjs(dateString).isValid();
}

function intervalsOverlap(startA, endA, startB, endB) {
  return dayjs(startA).isBefore(dayjs(endB)) && dayjs(startB).isBefore(dayjs(endA));
}

module.exports = {
  dayjs,
  isValidIsoDate,
  intervalsOverlap
};
