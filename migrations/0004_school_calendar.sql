-- The school's academic calendar, on the profile: its semesters (first and last day of
-- classes) and special days (no classes, study break, exams, a day that follows another
-- weekday's timetable, markers). A JSON object; {} is none. The Worker checks its shape
-- (worker/validate.js); public/js/school.js reads it, in the app and the calendar feed.

ALTER TABLE users ADD COLUMN school_calendar TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(school_calendar) AND json_type(school_calendar) = 'object');
