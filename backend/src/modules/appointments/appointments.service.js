const db = require("../../db/connection");
const { dayjs, intervalsOverlap } = require("../../utils/date");

const artistByUserStmt = db.prepare("SELECT id FROM artists WHERE user_id = ?");

function getArtistIdForUser(userId) {
  const artist = artistByUserStmt.get(userId);
  return artist ? artist.id : null;
}

function findScheduleConflicts(artistId, startAt, endAt, excludeAppointmentId = null) {
  let appointmentSql = `
    SELECT id, start_at, end_at, status
    FROM appointments
    WHERE artist_id = ?
      AND status <> 'cancelled'
      AND ? < end_at
      AND ? > start_at
  `;
  const appointmentParams = [artistId, startAt, endAt];

  if (excludeAppointmentId) {
    appointmentSql += " AND id <> ?";
    appointmentParams.push(excludeAppointmentId);
  }

  const blocked = db
    .prepare(
      `
        SELECT id, start_at, end_at, reason
        FROM calendar_blocks
        WHERE artist_id = ?
          AND ? < end_at
          AND ? > start_at
      `
    )
    .all(artistId, startAt, endAt);

  const appointments = db.prepare(appointmentSql).all(...appointmentParams);

  return {
    appointments,
    blocks: blocked
  };
}

function buildAvailabilitySlots({ artistId, date, durationMinutes = 120, excludeAppointmentId = null }) {
  const startOfDay = dayjs(date).hour(9).minute(0).second(0).millisecond(0);
  const endOfDay = dayjs(date).hour(20).minute(0).second(0).millisecond(0);
  if (!startOfDay.isValid()) {
    return [];
  }

  const dateKey = startOfDay.format("YYYY-MM-DD");
  let appointmentsSql = `
        SELECT start_at, end_at
        FROM appointments
        WHERE artist_id = ?
          AND status <> 'cancelled'
          AND date(start_at) = ?
      `;
  const appointmentsParams = [artistId, dateKey];
  if (excludeAppointmentId) {
    appointmentsSql += " AND id <> ?";
    appointmentsParams.push(excludeAppointmentId);
  }
  const appointments = db.prepare(appointmentsSql).all(...appointmentsParams);

  const blocks = db
    .prepare(
      `
        SELECT start_at, end_at
        FROM calendar_blocks
        WHERE artist_id = ?
          AND date(start_at) = ?
      `
    )
    .all(artistId, dateKey);

  const busyIntervals = [...appointments, ...blocks];
  const slots = [];
  let cursor = startOfDay;

  while (cursor.add(durationMinutes, "minute").isBefore(endOfDay) || cursor.add(durationMinutes, "minute").isSame(endOfDay)) {
    const slotEnd = cursor.add(durationMinutes, "minute");
    const hasConflict = busyIntervals.some((busy) =>
      intervalsOverlap(cursor.toISOString(), slotEnd.toISOString(), busy.start_at, busy.end_at)
    );

    if (!hasConflict) {
      slots.push({
        startAt: cursor.toISOString(),
        endAt: slotEnd.toISOString()
      });
    }

    cursor = cursor.add(30, "minute");
  }

  return slots;
}

module.exports = {
  getArtistIdForUser,
  findScheduleConflicts,
  buildAvailabilitySlots
};
