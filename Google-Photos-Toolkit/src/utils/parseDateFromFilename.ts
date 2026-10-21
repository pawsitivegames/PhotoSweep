/**
 * Date parser utility inspired by exiftool's approach.
 *
 * Extracts date/time from filenames using a sequential digit extraction algorithm:
 * 1. First 4 consecutive digits → Year (YYYY)
 * 2. Next 2 digits → Month (MM)
 * 3. Next 2 digits → Day (DD)
 * 4. Next 2 digits → Hour (HH) [optional]
 * 5. Next 2 digits → Minute (MM) [optional]
 * 6. Next 2 digits → Second (SS) [optional]
 *
 * This is separator-agnostic, meaning any non-digit characters between
 * numbers are ignored (e.g., "2023-05-15", "20230515", "2023_05_15" all work).
 *
 * @example
 * parseDateFromFilename("IMG_20230515_143022.jpg") // → 2023-05-15T14:30:22
 * parseDateFromFilename("Screenshot_2023-05-15-14-30-22.png") // → 2023-05-15T14:30:22
 * parseDateFromFilename("photo_20230515.jpg") // → 2023-05-15T00:00:00
 */

export interface ParsedDate {
  /** Timestamp in epoch milliseconds */
  timestamp: number;
  /** Year extracted from filename */
  year: number;
  /** Month extracted from filename (1-12) */
  month: number;
  /** Day extracted from filename (1-31) */
  day: number;
  /** Hour extracted from filename (0-23), defaults to 0 */
  hour: number;
  /** Minute extracted from filename (0-59), defaults to 0 */
  minute: number;
  /** Second extracted from filename (0-59), defaults to 0 */
  second: number;
}

/**
 * Extract all digit sequences from a string.
 * Returns an array of { value: string, index: number } objects.
 */
function extractDigitSequences(str: string): Array<{ value: string; index: number }> {
  const sequences: Array<{ value: string; index: number }> = [];
  const regex = /\d+/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(str)) !== null) {
    sequences.push({ value: match[0], index: match.index });
  }

  return sequences;
}

/**
 * Validate that the extracted values form a valid date.
 */
function isValidDate(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  // Basic range checks
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  // Check if the date is actually valid (handles Feb 30, etc.)
  const date = new Date(year, month - 1, day, hour, minute, second);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === second
  );
}

/**
 * Parse a date from a filename using exiftool's sequential digit extraction approach.
 *
 * The algorithm:
 * 1. Extract all digit sequences from the filename
 * 2. Find a 4-digit sequence that could be a valid year (1900-2100)
 * 3. Look for subsequent 2-digit sequences for month, day, hour, minute, second
 * 4. Validate the resulting date
 *
 * @param filename - The filename to parse (can include path and extension)
 * @returns ParsedDate object if a valid date was found, null otherwise
 */
export function parseDateFromFilename(filename: string): ParsedDate | null {
  // Extract just the filename without path
  const baseName = filename.replace(/^.*[\\/]/, '');

  // Extract all digit sequences
  const sequences = extractDigitSequences(baseName);

  if (sequences.length === 0) return null;

  // Try different starting points for the year
  for (let startIdx = 0; startIdx < sequences.length; startIdx++) {
    const result = tryParseFromSequence(sequences, startIdx);
    if (result) return result;
  }

  return null;
}

/**
 * Try to parse a date starting from a specific sequence index.
 */
function tryParseFromSequence(
  sequences: Array<{ value: string; index: number }>,
  startIdx: number
): ParsedDate | null {
  const firstSeq = sequences[startIdx];

  // Case 1: First sequence is exactly 4 digits (year)
  if (firstSeq.value.length === 4) {
    return tryParseWithSeparateComponents(sequences, startIdx);
  }

  // Case 2: First sequence is 8 digits (YYYYMMDD) - look for separate time sequence
  if (firstSeq.value.length === 8) {
    const dateResult = tryParseConcatenatedFormat(firstSeq.value);
    if (dateResult && startIdx + 1 < sequences.length) {
      // Check if next sequence could be time (HHMMSS or 6 digits)
      const nextSeq = sequences[startIdx + 1];
      if (nextSeq.value.length === 6) {
        const timeResult = tryParseTimeSequence(nextSeq.value);
        if (timeResult) {
          // Combine date and time
          const fullDate = new Date(
            dateResult.year,
            dateResult.month - 1,
            dateResult.day,
            timeResult.hour,
            timeResult.minute,
            timeResult.second
          );
          return {
            ...dateResult,
            hour: timeResult.hour,
            minute: timeResult.minute,
            second: timeResult.second,
            timestamp: fullDate.getTime(),
          };
        }
      }
    }
    return dateResult;
  }

  // Case 3: First sequence is 14 digits (YYYYMMDDHHMMSS)
  if (firstSeq.value.length === 14) {
    return tryParseConcatenatedFormat(firstSeq.value);
  }

  // Case 4: First sequence is more than 8 but less than 14 digits
  if (firstSeq.value.length > 8 && firstSeq.value.length < 14) {
    return tryParseConcatenatedFormat(firstSeq.value);
  }

  return null;
}

/**
 * Parse time from a 6-digit sequence (HHMMSS).
 */
function tryParseTimeSequence(digits: string): { hour: number; minute: number; second: number } | null {
  if (digits.length !== 6) return null;

  const hour = parseInt(digits.substring(0, 2), 10);
  const minute = parseInt(digits.substring(2, 4), 10);
  const second = parseInt(digits.substring(4, 6), 10);

  // Validate time components
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;

  return { hour, minute, second };
}

/**
 * Parse date when digits are in a single concatenated sequence.
 * Handles formats like: 20230515, 20230515143022
 */
function tryParseConcatenatedFormat(digits: string): ParsedDate | null {
  if (digits.length < 8) return null;

  const year = parseInt(digits.substring(0, 4), 10);
  const month = parseInt(digits.substring(4, 6), 10);
  const day = parseInt(digits.substring(6, 8), 10);

  let hour = 0;
  let minute = 0;
  let second = 0;

  if (digits.length >= 10) {
    hour = parseInt(digits.substring(8, 10), 10);
  }
  if (digits.length >= 12) {
    minute = parseInt(digits.substring(10, 12), 10);
  }
  if (digits.length >= 14) {
    second = parseInt(digits.substring(12, 14), 10);
  }

  if (!isValidDate(year, month, day, hour, minute, second)) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, second);

  return {
    timestamp: date.getTime(),
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

/**
 * Parse date when components are separated (e.g., 2023-05-15-14-30-22).
 */
function tryParseWithSeparateComponents(
  sequences: Array<{ value: string; index: number }>,
  yearIdx: number
): ParsedDate | null {
  if (yearIdx >= sequences.length) return null;

  const yearSeq = sequences[yearIdx];

  // Year must be exactly 4 digits
  if (yearSeq.value.length !== 4) return null;

  const year = parseInt(yearSeq.value, 10);
  if (year < 1900 || year > 2100) return null;

  // Look for subsequent components
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let foundMonth = false;
  let foundDay = false;

  // Process remaining sequences
  let seqIdx = yearIdx + 1;

  // Month
  if (seqIdx < sequences.length) {
    const monthVal = extractTwoDigitValue(sequences[seqIdx].value);
    if (monthVal !== null && monthVal >= 1 && monthVal <= 12) {
      month = monthVal;
      foundMonth = true;
      seqIdx++;
    }
  }

  // Day
  if (foundMonth && seqIdx < sequences.length) {
    const dayVal = extractTwoDigitValue(sequences[seqIdx].value);
    if (dayVal !== null && dayVal >= 1 && dayVal <= 31) {
      day = dayVal;
      foundDay = true;
      seqIdx++;
    }
  }

  // Hour
  if (foundDay && seqIdx < sequences.length) {
    const hourVal = extractTwoDigitValue(sequences[seqIdx].value);
    if (hourVal !== null && hourVal >= 0 && hourVal <= 23) {
      hour = hourVal;
      seqIdx++;
    }
  }

  // Minute
  if (seqIdx < sequences.length && hour > 0) {
    const minuteVal = extractTwoDigitValue(sequences[seqIdx].value);
    if (minuteVal !== null && minuteVal >= 0 && minuteVal <= 59) {
      minute = minuteVal;
      seqIdx++;
    }
  }

  // Second
  if (seqIdx < sequences.length && minute > 0) {
    const secondVal = extractTwoDigitValue(sequences[seqIdx].value);
    if (secondVal !== null && secondVal >= 0 && secondVal <= 59) {
      second = secondVal;
    }
  }

  // Must have at least year, month, and day
  if (!foundMonth || !foundDay) return null;

  if (!isValidDate(year, month, day, hour, minute, second)) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, second);

  return {
    timestamp: date.getTime(),
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

/**
 * Extract a 2-digit value from a sequence.
 * If the sequence is longer, only the first 2 digits are used.
 */
function extractTwoDigitValue(seq: string): number | null {
  if (seq.length < 2) return null;
  const val = parseInt(seq.substring(0, 2), 10);
  return isNaN(val) ? null : val;
}

/**
 * Format a ParsedDate as an ISO-like string for display.
 */
export function formatParsedDate(parsed: ParsedDate): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)} ${pad(parsed.hour)}:${pad(parsed.minute)}:${pad(parsed.second)}`;
}
