const fs = require("fs");
const path = require("path");
const {
  PDFDocument,
  StandardFonts,
  rgb,
} = require("pdf-lib");

const MM_TO_POINTS = 72 / 25.4;

const PAGE_WIDTH_MM = 216;
const PAGE_HEIGHT_MM = 154;
const BLEED_MM = 3;
const SAFE_MARGIN_MM = 10;

const PAGE_WIDTH = PAGE_WIDTH_MM * MM_TO_POINTS;
const PAGE_HEIGHT = PAGE_HEIGHT_MM * MM_TO_POINTS;
const BLEED = BLEED_MM * MM_TO_POINTS;
const SAFE_MARGIN = SAFE_MARGIN_MM * MM_TO_POINTS;

const DEFAULT_ACCENT = rgb(0.725, 0.514, 0.333);
const DEFAULT_BACKGROUND = rgb(1, 0.992, 0.973);
const DEFAULT_TEXT = rgb(0.129, 0.118, 0.106);

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Converts any supplied value into a trimmed string.
 */
function clean(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

/**
 * Standard PDF fonts cannot render emoji or every Unicode character.
 * This converts punctuation and removes unsupported characters so a
 * customer-entered emoji does not crash the entire PDF generator.
 */
function pdfText(value, fallback = "") {
  return clean(value, fallback)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Supports:
 * - Shopify REST lineItem.properties
 * - Shopify GraphQL customAttributes
 * - Plain property objects
 */
function propertiesToObject(lineItem) {
  const result = {};

  const properties =
    lineItem?.properties ??
    lineItem?.customAttributes ??
    [];

  if (Array.isArray(properties)) {
    for (const property of properties) {
      const name =
        property?.name ??
        property?.key;

      if (!name) {
        continue;
      }

      const value = property?.value ?? "";

      result[name] = value;
      result[normalizeKey(name)] = value;
    }

    return result;
  }

  if (
    properties &&
    typeof properties === "object"
  ) {
    for (const [name, value] of Object.entries(properties)) {
      result[name] = value;
      result[normalizeKey(name)] = value;
    }
  }

  return result;
}

function getProperty(
  properties,
  names,
  fallback = ""
) {
  for (const name of names) {
    const direct = properties[name];

    const normalized =
      properties[normalizeKey(name)];

    const value =
      direct ??
      normalized;

    if (clean(value)) {
      return clean(value);
    }
  }

  return fallback;
}

function isEnabled(value) {
  return /^(yes|true|1|on|checked|include|included)$/i.test(
    clean(value)
  );
}

function parseHexColor(value, fallback) {
  const cleaned = clean(value)
    .replace(/^#/, "");

  if (!/^[0-9a-f]{6}$/i.test(cleaned)) {
    return fallback;
  }

  return rgb(
    parseInt(cleaned.slice(0, 2), 16) / 255,
    parseInt(cleaned.slice(2, 4), 16) / 255,
    parseInt(cleaned.slice(4, 6), 16) / 255
  );
}

function mixColor(
  colorA,
  colorB,
  amount = 0.5
) {
  const safeAmount = Math.max(
    0,
    Math.min(1, amount)
  );

  return rgb(
    colorA.red +
      (colorB.red - colorA.red) *
        safeAmount,
    colorA.green +
      (colorB.green - colorA.green) *
        safeAmount,
    colorA.blue +
      (colorB.blue - colorA.blue) *
        safeAmount
  );
}

function contrastingColor(color) {
  const luminance =
    0.2126 * color.red +
    0.7152 * color.green +
    0.0722 * color.blue;

  return luminance > 0.62
    ? rgb(0.08, 0.07, 0.06)
    : rgb(1, 1, 1);
}

function sanitize(value, fallback) {
  return clean(value, fallback)
    .replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Reads Shopify's month input format:
 * YYYY-MM
 *
 * This avoids timezone shifts that can happen with:
 * new Date("2026-08")
 */
function parseStartMonth(value) {
  const match = clean(value).match(
    /^(\d{4})-(\d{2})$/
  );

  if (match) {
    const year = Number(match[1]);
    const monthIndex =
      Number(match[2]) - 1;

    if (
      year >= 2000 &&
      year <= 2200 &&
      monthIndex >= 0 &&
      monthIndex <= 11
    ) {
      return new Date(
        year,
        monthIndex,
        1,
        12,
        0,
        0,
        0
      );
    }
  }

  const now = new Date();

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    12,
    0,
    0,
    0
  );
}

function parseMonthCount(value) {
  const parsed = Number.parseInt(
    clean(value),
    10
  );

  if (!Number.isFinite(parsed)) {
    return 12;
  }

  return Math.max(
    1,
    Math.min(36, parsed)
  );
}

function addMonths(date, amount) {
  return new Date(
    date.getFullYear(),
    date.getMonth() + amount,
    1,
    12,
    0,
    0,
    0
  );
}

function dateKey(
  year,
  monthIndex,
  day
) {
  return [
    year,
    String(monthIndex + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function fitText(
  font,
  text,
  maxWidth,
  preferred,
  minimum = 5
) {
  const safeText = pdfText(text);

  let size = preferred;

  while (
    size > minimum &&
    font.widthOfTextAtSize(
      safeText,
      size
    ) > maxWidth
  ) {
    size -= 0.5;
  }

  return size;
}

function truncateToWidth(
  font,
  text,
  size,
  maxWidth
) {
  const safeText = pdfText(text);

  if (
    font.widthOfTextAtSize(
      safeText,
      size
    ) <= maxWidth
  ) {
    return safeText;
  }

  let output = safeText;

  while (
    output.length > 1 &&
    font.widthOfTextAtSize(
      `${output}...`,
      size
    ) > maxWidth
  ) {
    output = output.slice(0, -1);
  }

  return `${output.trim()}...`;
}

function wrapText(
  font,
  text,
  size,
  maxWidth,
  maxLines = Infinity
) {
  const paragraphs = clean(text)
    .split(/\r?\n/)
    .map((line) => pdfText(line))
    .filter(Boolean);

  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph
      .split(/\s+/)
      .filter(Boolean);

    let current = "";

    for (const word of words) {
      const candidate = current
        ? `${current} ${word}`
        : word;

      if (
        font.widthOfTextAtSize(
          candidate,
          size
        ) <= maxWidth
      ) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }

      current = truncateToWidth(
        font,
        word,
        size,
        maxWidth
      );

      if (lines.length >= maxLines) {
        break;
      }
    }

    if (lines.length >= maxLines) {
      break;
    }

    if (current) {
      lines.push(current);
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  return lines;
}

function drawCentered(
  page,
  text,
  y,
  font,
  size,
  color
) {
  const safeText = pdfText(text);

  if (!safeText) {
    return;
  }

  const width =
    font.widthOfTextAtSize(
      safeText,
      size
    );

  page.drawText(safeText, {
    x: (PAGE_WIDTH - width) / 2,
    y,
    font,
    size,
    color,
  });
}

function drawRight(
  page,
  text,
  rightX,
  y,
  font,
  size,
  color
) {
  const safeText = pdfText(text);

  if (!safeText) {
    return;
  }

  page.drawText(safeText, {
    x:
      rightX -
      font.widthOfTextAtSize(
        safeText,
        size
      ),
    y,
    font,
    size,
    color,
  });
}

function monthHeadingFont(
  fonts,
  style
) {
  const normalized =
    normalizeKey(style);

  if (normalized === "modernclean") {
    return fonts.helvetica;
  }

  if (normalized === "elegantserif") {
    return fonts.timesItalic;
  }

  /*
   * StandardFonts does not contain a script font.
   * Times Italic provides the closest safe embedded option.
   */
  return fonts.timesItalic;
}

function monthHeadingText(
  date,
  style
) {
  const monthName =
    date.toLocaleDateString(
      "en-US",
      {
        month: "long",
      }
    );

  return normalizeKey(style) ===
    "modernclean"
    ? monthName.toUpperCase()
    : monthName;
}

function weekdayLabels(
  style,
  weekStartsOn
) {
  let labels;

  switch (normalizeKey(style)) {
    case "singleletter":
      labels = [
        "S",
        "M",
        "T",
        "W",
        "T",
        "F",
        "S",
      ];
      break;

    case "full":
      labels = [...WEEKDAYS];
      break;

    default:
      labels = [
        "Sun",
        "Mon",
        "Tue",
        "Wed",
        "Thu",
        "Fri",
        "Sat",
      ];
      break;
  }

  if (
    normalizeKey(weekStartsOn) ===
    "monday"
  ) {
    return [
      ...labels.slice(1),
      labels[0],
    ];
  }

  return labels;
}

function startingCellForMonth(
  year,
  monthIndex,
  weekStartsOn
) {
  const sundayBased =
    new Date(
      year,
      monthIndex,
      1,
      12,
      0,
      0
    ).getDay();

  if (
    normalizeKey(weekStartsOn) ===
    "monday"
  ) {
    return (sundayBased + 6) % 7;
  }

  return sundayBased;
}

function nthWeekdayOfMonth(
  year,
  monthIndex,
  weekday,
  occurrence
) {
  if (occurrence === "last") {
    const lastDay = new Date(
      year,
      monthIndex + 1,
      0,
      12,
      0,
      0
    );

    const difference =
      (
        lastDay.getDay() -
        weekday +
        7
      ) % 7;

    return (
      lastDay.getDate() -
      difference
    );
  }

  const occurrenceIndex = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
  }[occurrence];

  if (!occurrenceIndex) {
    return null;
  }

  const firstDayWeekday =
    new Date(
      year,
      monthIndex,
      1,
      12,
      0,
      0
    ).getDay();

  const firstOccurrence =
    1 +
    (
      weekday -
      firstDayWeekday +
      7
    ) %
      7;

  const day =
    firstOccurrence +
    (occurrenceIndex - 1) * 7;

  const daysInMonth =
    new Date(
      year,
      monthIndex + 1,
      0,
      12,
      0,
      0
    ).getDate();

  return day <= daysInMonth
    ? day
    : null;
}

function standardUsHolidays(year) {
  return [
    {
      monthIndex: 0,
      day: 1,
      label: "New Year's Day",
    },
    {
      monthIndex: 0,
      day: nthWeekdayOfMonth(
        year,
        0,
        1,
        "third"
      ),
      label: "MLK Day",
    },
    {
      monthIndex: 1,
      day: nthWeekdayOfMonth(
        year,
        1,
        1,
        "third"
      ),
      label: "Presidents' Day",
    },
    {
      monthIndex: 4,
      day: nthWeekdayOfMonth(
        year,
        4,
        1,
        "last"
      ),
      label: "Memorial Day",
    },
    {
      monthIndex: 5,
      day: 19,
      label: "Juneteenth",
    },
    {
      monthIndex: 6,
      day: 4,
      label: "Independence Day",
    },
    {
      monthIndex: 8,
      day: nthWeekdayOfMonth(
        year,
        8,
        1,
        "first"
      ),
      label: "Labor Day",
    },
    {
      monthIndex: 9,
      day: nthWeekdayOfMonth(
        year,
        9,
        1,
        "second"
      ),
      label:
        "Indigenous Peoples' Day",
    },
    {
      monthIndex: 10,
      day: 11,
      label: "Veterans Day",
    },
    {
      monthIndex: 10,
      day: nthWeekdayOfMonth(
        year,
        10,
        4,
        "fourth"
      ),
      label: "Thanksgiving",
    },
    {
      monthIndex: 11,
      day: 25,
      label: "Christmas Day",
    },
  ].filter((holiday) =>
    Number.isInteger(holiday.day)
  );
}

/**
 * Approximate major moon phases using a known new moon
 * and the average synodic month.
 */
function moonPhaseForDate(date) {
  const referenceNewMoonUtc =
    Date.UTC(
      2000,
      0,
      6,
      18,
      14,
      0
    );

  const synodicMonthDays =
    29.530588853;

  const dateUtc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0
  );

  const daysSinceReference =
    (
      dateUtc -
      referenceNewMoonUtc
    ) /
    86400000;

  const age =
    (
      (
        daysSinceReference %
        synodicMonthDays
      ) +
      synodicMonthDays
    ) %
    synodicMonthDays;

  const phases = [
    {
      age: 0,
      label: "New Moon",
    },
    {
      age:
        synodicMonthDays /
        4,
      label: "First Quarter",
    },
    {
      age:
        synodicMonthDays /
        2,
      label: "Full Moon",
    },
    {
      age:
        (
          synodicMonthDays *
          3
        ) /
        4,
      label: "Last Quarter",
    },
  ];

  let closest = null;

  for (const phase of phases) {
    const rawDifference =
      Math.abs(
        age -
        phase.age
      );

    const circularDifference =
      Math.min(
        rawDifference,
        synodicMonthDays -
          rawDifference
      );

    if (
      !closest ||
      circularDifference <
        closest.difference
    ) {
      closest = {
        ...phase,
        difference:
          circularDifference,
      };
    }
  }

  if (
    closest &&
    closest.difference <= 0.55
  ) {
    return closest.label;
  }

  return "";
}

function addEvent(
  eventMap,
  key,
  label,
  priority = 0
) {
  const safeLabel = pdfText(label);

  if (!safeLabel) {
    return;
  }

  if (!eventMap.has(key)) {
    eventMap.set(key, []);
  }

  const events =
    eventMap.get(key);

  const duplicate = events.some(
    (event) =>
      normalizeKey(event.label) ===
      normalizeKey(safeLabel)
  );

  if (duplicate) {
    return;
  }

  events.push({
    label: safeLabel,
    priority,
  });

  events.sort(
    (a, b) =>
      b.priority -
      a.priority
  );
}

function parseImportantDates(
  value,
  calendarStartYear
) {
  const events = [];

  for (
    const rawLine of
    clean(value).split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    /*
     * Supported:
     * 07/04/2026 - Event
     * 07/04 - Event
     */
    let match = line.match(
      /^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\s*(?:-|:|\u2013|\u2014)\s*(.+)$/
    );

    if (match) {
      const monthIndex =
        Number(match[1]) - 1;

      const day =
        Number(match[2]);

      const year = match[3]
        ? Number(match[3])
        : null;

      const label =
        match[4];

      if (
        monthIndex >= 0 &&
        monthIndex <= 11 &&
        day >= 1 &&
        day <= 31
      ) {
        events.push({
          monthIndex,
          day,
          year,
          label,
        });
      }

      continue;
    }

    /*
     * Supported:
     * 2026-07-04 - Event
     */
    match = line.match(
      /^(\d{4})-(\d{2})-(\d{2})\s*(?:-|:|\u2013|\u2014)\s*(.+)$/
    );

    if (match) {
      events.push({
        year: Number(match[1]),
        monthIndex:
          Number(match[2]) - 1,
        day: Number(match[3]),
        label: match[4],
      });

      continue;
    }

    /*
     * Unrecognized lines are preserved and displayed
     * in the reminders area instead of being deleted.
     */
    events.push({
      year:
        calendarStartYear,
      monthIndex: null,
      day: null,
      label: line,
      unparsed: true,
    });
  }

  return events;
}

function weekdayIndex(name) {
  return WEEKDAYS.findIndex(
    (weekday) =>
      normalizeKey(weekday) ===
      normalizeKey(name)
  );
}

function recurringRuleLabel(
  rawLabel,
  fallback
) {
  const label = pdfText(rawLabel)
    .replace(
      /\b(on|the)\s*$/i,
      ""
    )
    .trim();

  return label || fallback;
}

/**
 * Supported recurring reminder examples:
 *
 * Payday every other Friday
 * Family dinner every Sunday
 * Content planning on the first Monday
 * Billing review on the last Friday
 * Rent on the 1st every month
 */
function parseRecurringRules(value) {
  const rules = [];

  for (
    const rawLine of
    clean(value).split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    let match = line.match(
      /^(.*?)\s+(?:on\s+)?every\s+other\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i
    );

    if (match) {
      rules.push({
        type:
          "everyOtherWeekday",
        label:
          recurringRuleLabel(
            match[1],
            line
          ),
        weekday:
          weekdayIndex(match[2]),
        source: line,
      });

      continue;
    }

    match = line.match(
      /^(.*?)\s+(?:on\s+)?every\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i
    );

    if (match) {
      rules.push({
        type: "everyWeekday",
        label:
          recurringRuleLabel(
            match[1],
            line
          ),
        weekday:
          weekdayIndex(match[2]),
        source: line,
      });

      continue;
    }

    match = line.match(
      /^(.*?)\s+(?:on\s+)?(?:the\s+)?(first|second|third|fourth|last)\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)(?:\s+of\s+(?:each|every)\s+month)?$/i
    );

    if (match) {
      rules.push({
        type: "nthWeekday",
        label:
          recurringRuleLabel(
            match[1],
            line
          ),
        occurrence:
          match[2].toLowerCase(),
        weekday:
          weekdayIndex(match[3]),
        source: line,
      });

      continue;
    }

    match = line.match(
      /^(.*?)\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+(?:each|every)\s+month|\s+every\s+month)$/i
    );

    if (match) {
      rules.push({
        type: "dayOfMonth",
        label:
          recurringRuleLabel(
            match[1],
            line
          ),
        day:
          Number(match[2]),
        source: line,
      });

      continue;
    }

    rules.push({
      type: "unparsed",
      source: line,
      label: line,
    });
  }

  return rules;
}

function buildEventMap({
  startDate,
  monthCount,
  importantDates,
  recurringRules,
  includeHolidays,
  includeMoonPhases,
}) {
  const eventMap =
    new Map();

  const endDate =
    addMonths(
      startDate,
      monthCount
    );

  /*
   * Add customer-entered important dates.
   */
  for (const event of importantDates) {
    if (event.unparsed) {
      continue;
    }

    if (event.year !== null) {
      const date = new Date(
        event.year,
        event.monthIndex,
        event.day,
        12,
        0,
        0
      );

      if (
        date >= startDate &&
        date < endDate
      ) {
        addEvent(
          eventMap,
          dateKey(
            event.year,
            event.monthIndex,
            event.day
          ),
          event.label,
          100
        );
      }

      continue;
    }

    /*
     * Dates without a year repeat annually.
     */
    for (
      let offset = 0;
      offset < monthCount;
      offset += 1
    ) {
      const monthDate =
        addMonths(
          startDate,
          offset
        );

      if (
        monthDate.getMonth() !==
        event.monthIndex
      ) {
        continue;
      }

      const daysInMonth =
        new Date(
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          0,
          12,
          0,
          0
        ).getDate();

      if (
        event.day <=
        daysInMonth
      ) {
        addEvent(
          eventMap,
          dateKey(
            monthDate.getFullYear(),
            monthDate.getMonth(),
            event.day
          ),
          event.label,
          100
        );
      }
    }
  }

  /*
   * Add standard U.S. holidays when selected.
   */
  if (includeHolidays) {
    const years = new Set();

    for (
      let offset = 0;
      offset < monthCount;
      offset += 1
    ) {
      years.add(
        addMonths(
          startDate,
          offset
        ).getFullYear()
      );
    }

    for (const year of years) {
      for (
        const holiday of
        standardUsHolidays(year)
      ) {
        const date = new Date(
          year,
          holiday.monthIndex,
          holiday.day,
          12,
          0,
          0
        );

        if (
          date >= startDate &&
          date < endDate
        ) {
          addEvent(
            eventMap,
            dateKey(
              year,
              holiday.monthIndex,
              holiday.day
            ),
            holiday.label,
            60
          );
        }
      }
    }
  }

  /*
   * Establish the first matching date for
   * every-other-week reminders.
   */
  const everyOtherAnchors =
    new Map();

  for (
    const rule of
    recurringRules
  ) {
    if (
      rule.type !==
      "everyOtherWeekday"
    ) {
      continue;
    }

    const anchor =
      new Date(startDate);

    const daysUntilWeekday =
      (
        rule.weekday -
        anchor.getDay() +
        7
      ) %
      7;

    anchor.setDate(
      anchor.getDate() +
        daysUntilWeekday
    );

    everyOtherAnchors.set(
      rule,
      anchor
    );
  }

  for (
    let offset = 0;
    offset < monthCount;
    offset += 1
  ) {
    const monthDate =
      addMonths(
        startDate,
        offset
      );

    const year =
      monthDate.getFullYear();

    const monthIndex =
      monthDate.getMonth();

    const daysInMonth =
      new Date(
        year,
        monthIndex + 1,
        0,
        12,
        0,
        0
      ).getDate();

    for (
      const rule of
      recurringRules
    ) {
      if (
        rule.type ===
        "everyWeekday"
      ) {
        for (
          let day = 1;
          day <= daysInMonth;
          day += 1
        ) {
          const date = new Date(
            year,
            monthIndex,
            day,
            12,
            0,
            0
          );

          if (
            date.getDay() ===
            rule.weekday
          ) {
            addEvent(
              eventMap,
              dateKey(
                year,
                monthIndex,
                day
              ),
              rule.label,
              80
            );
          }
        }
      } else if (
        rule.type ===
        "everyOtherWeekday"
      ) {
        const anchor =
          everyOtherAnchors.get(
            rule
          );

        for (
          let day = 1;
          day <= daysInMonth;
          day += 1
        ) {
          const date = new Date(
            year,
            monthIndex,
            day,
            12,
            0,
            0
          );

          const daysDifference =
            Math.round(
              (
                date -
                anchor
              ) /
                86400000
            );

          if (
            daysDifference >= 0 &&
            daysDifference % 14 ===
              0 &&
            date.getDay() ===
              rule.weekday
          ) {
            addEvent(
              eventMap,
              dateKey(
                year,
                monthIndex,
                day
              ),
              rule.label,
              80
            );
          }
        }
      } else if (
        rule.type ===
        "nthWeekday"
      ) {
        const day =
          nthWeekdayOfMonth(
            year,
            monthIndex,
            rule.weekday,
            rule.occurrence
          );

        if (day) {
          addEvent(
            eventMap,
            dateKey(
              year,
              monthIndex,
              day
            ),
            rule.label,
            80
          );
        }
      } else if (
        rule.type ===
        "dayOfMonth"
      ) {
        if (
          rule.day >= 1 &&
          rule.day <=
            daysInMonth
        ) {
          addEvent(
            eventMap,
            dateKey(
              year,
              monthIndex,
              rule.day
            ),
            rule.label,
            80
          );
        }
      }
    }

    /*
     * Add approximate moon phases when selected.
     */
    if (includeMoonPhases) {
      for (
        let day = 1;
        day <= daysInMonth;
        day += 1
      ) {
        const date = new Date(
          year,
          monthIndex,
          day,
          12,
          0,
          0
        );

        const phase =
          moonPhaseForDate(date);

        if (phase) {
          addEvent(
            eventMap,
            dateKey(
              year,
              monthIndex,
              day
            ),
            phase,
            20
          );
        }
      }
    }
  }

  return eventMap;
}

function drawCover({
  page,
  fonts,
  calendarTitle,
  ownerName,
  subtitle,
  startDate,
  monthCount,
  accent,
  background,
  textColor,
  headerStyle,
}) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: background,
  });

  const borderInset =
    BLEED +
    SAFE_MARGIN;

  const borderColor =
    mixColor(
      accent,
      textColor,
      0.12
    );

  page.drawRectangle({
    x: borderInset,
    y: borderInset,
    width:
      PAGE_WIDTH -
      2 * borderInset,
    height:
      PAGE_HEIGHT -
      2 * borderInset,
    borderColor,
    borderWidth: 1.4,
  });

  const endDate =
    addMonths(
      startDate,
      monthCount - 1
    );

  const dateRange = [
    startDate.toLocaleDateString(
      "en-US",
      {
        month: "long",
        year: "numeric",
      }
    ),
    endDate.toLocaleDateString(
      "en-US",
      {
        month: "long",
        year: "numeric",
      }
    ),
  ].join(" - ");

  if (ownerName) {
    const uppercaseOwner =
      pdfText(
        ownerName
      ).toUpperCase();

    const ownerSize =
      fitText(
        fonts.helveticaBold,
        uppercaseOwner,
        PAGE_WIDTH -
          60 * MM_TO_POINTS,
        8,
        6
      );

    drawCentered(
      page,
      uppercaseOwner,
      PAGE_HEIGHT * 0.77,
      fonts.helveticaBold,
      ownerSize,
      accent
    );
  }

  const titleFont =
    monthHeadingFont(
      fonts,
      headerStyle
    );

  const titleSize =
    fitText(
      titleFont,
      calendarTitle,
      PAGE_WIDTH -
        50 * MM_TO_POINTS,
      35,
      17
    );

  drawCentered(
    page,
    calendarTitle,
    PAGE_HEIGHT * 0.58,
    titleFont,
    titleSize,
    accent
  );

  if (subtitle) {
    const uppercaseSubtitle =
      pdfText(
        subtitle
      ).toUpperCase();

    const subtitleSize =
      fitText(
        fonts.helveticaBold,
        uppercaseSubtitle,
        PAGE_WIDTH -
          55 * MM_TO_POINTS,
        8,
        5.5
      );

    drawCentered(
      page,
      uppercaseSubtitle,
      PAGE_HEIGHT * 0.44,
      fonts.helveticaBold,
      subtitleSize,
      textColor
    );
  }

  drawCentered(
    page,
    dateRange,
    PAGE_HEIGHT * 0.31,
    fonts.timesRoman,
    13,
    textColor
  );

  drawCentered(
    page,
    "FRESH START PAPER",
    BLEED +
      SAFE_MARGIN +
      4 * MM_TO_POINTS,
    fonts.helveticaBold,
    7,
    accent
  );
}

function drawNotesArea({
  page,
  fonts,
  x,
  y,
  width,
  height,
  notesLabel,
  notesStyle,
  recurringUnparsed,
  accent,
  textColor,
  lineColor,
}) {
  const hasRecurring =
    recurringUnparsed.length > 0;

  const gap = 8;

  const notesWidth =
    hasRecurring
      ? width * 0.66
      : width;

  const recurringX =
    x +
    notesWidth +
    gap;

  const recurringWidth =
    Math.max(
      0,
      width -
        notesWidth -
        gap
    );

  page.drawText(
    pdfText(
      notesLabel,
      "Notes and intentions"
    ).toUpperCase(),
    {
      x,
      y:
        y +
        height -
        8,
      font:
        fonts.helveticaBold,
      size: 7,
      color: accent,
    }
  );

  const style =
    normalizeKey(notesStyle);

  const contentTop =
    y +
    height -
    14;

  const contentBottom =
    y + 2;

  if (
    style ===
      "monthlypriorities" ||
    style ===
      "goalsandgratitude"
  ) {
    const leftHeading =
      style ===
      "monthlypriorities"
        ? "TOP PRIORITIES"
        : "GOALS";

    const rightHeading =
      style ===
      "monthlypriorities"
        ? "NEXT STEPS"
        : "GRATITUDE";

    const dividerX =
      x +
      notesWidth / 2;

    page.drawText(
      leftHeading,
      {
        x,
        y:
          contentTop -
          1,
        font:
          fonts.helveticaBold,
        size: 5.5,
        color: textColor,
      }
    );

    page.drawText(
      rightHeading,
      {
        x:
          dividerX +
          5,
        y:
          contentTop -
          1,
        font:
          fonts.helveticaBold,
        size: 5.5,
        color: textColor,
      }
    );

    page.drawLine({
      start: {
        x: dividerX,
        y: contentBottom,
      },
      end: {
        x: dividerX,
        y:
          contentTop +
          2,
      },
      thickness: 0.45,
      color: lineColor,
    });

    for (
      let line = 0;
      line < 2;
      line += 1
    ) {
      const lineY =
        contentTop -
        9 -
        line * 8;

      page.drawLine({
        start: {
          x,
          y: lineY,
        },
        end: {
          x:
            dividerX -
            5,
          y: lineY,
        },
        thickness: 0.35,
        color: lineColor,
      });

      page.drawLine({
        start: {
          x:
            dividerX +
            5,
          y: lineY,
        },
        end: {
          x:
            x +
            notesWidth,
          y: lineY,
        },
        thickness: 0.35,
        color: lineColor,
      });
    }
  } else if (
    style !==
    "opennotesarea"
  ) {
    for (
      let lineY =
        contentTop - 3;
      lineY >=
      contentBottom;
      lineY -= 8
    ) {
      page.drawLine({
        start: {
          x,
          y: lineY,
        },
        end: {
          x:
            x +
            notesWidth,
          y: lineY,
        },
        thickness: 0.35,
        color: lineColor,
      });
    }
  }

  if (
    hasRecurring &&
    recurringWidth > 20
  ) {
    page.drawLine({
      start: {
        x:
          recurringX -
          gap / 2,
        y: y + 1,
      },
      end: {
        x:
          recurringX -
          gap / 2,
        y:
          y +
          height,
      },
      thickness: 0.45,
      color: lineColor,
    });

    page.drawText(
      "RECURRING",
      {
        x: recurringX,
        y:
          y +
          height -
          8,
        font:
          fonts.helveticaBold,
        size: 6.5,
        color: accent,
      }
    );

    let currentY =
      y +
      height -
      17;

    for (
      const reminder of
      recurringUnparsed.slice(
        0,
        3
      )
    ) {
      const lines =
        wrapText(
          fonts.helvetica,
          `- ${reminder}`,
          5.2,
          recurringWidth,
          2
        );

      for (
        const line of lines
      ) {
        if (
          currentY <
          y + 2
        ) {
          break;
        }

        page.drawText(
          line,
          {
            x: recurringX,
            y: currentY,
            font:
              fonts.helvetica,
            size: 5.2,
            color: textColor,
          }
        );

        currentY -=
          6.2;
      }

      if (
        currentY <
        y + 2
      ) {
        break;
      }
    }
  }
}

function drawMonth({
  page,
  fonts,
  date,
  calendarTitle,
  ownerName,
  subtitle,
  accent,
  background,
  textColor,
  notesLabel,
  notesStyle,
  footerQuote,
  headerStyle,
  gridStyle,
  weekStartsOn,
  weekdayLabelStyle,
  eventMap,
  recurringUnparsed,
}) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: background,
  });

  const left =
    BLEED +
    SAFE_MARGIN;

  const right =
    PAGE_WIDTH -
    BLEED -
    SAFE_MARGIN;

  const contentWidth =
    right -
    left;

  const lineColor =
    mixColor(
      textColor,
      background,
      0.78
    );

  const mutedText =
    mixColor(
      textColor,
      background,
      0.28
    );

  const year =
    date.getFullYear();

  const monthIndex =
    date.getMonth();

  if (ownerName) {
    page.drawText(
      truncateToWidth(
        fonts.helveticaBold,
        ownerName.toUpperCase(),
        6.5,
        contentWidth * 0.36
      ),
      {
        x: left,
        y:
          PAGE_HEIGHT -
          BLEED -
          SAFE_MARGIN +
          1,
        font:
          fonts.helveticaBold,
        size: 6.5,
        color: accent,
      }
    );
  }

  const smallTitle =
    truncateToWidth(
      fonts.timesRoman,
      calendarTitle,
      9,
      contentWidth * 0.55
    );

  drawCentered(
    page,
    smallTitle,
    PAGE_HEIGHT -
      BLEED -
      SAFE_MARGIN -
      1,
    fonts.timesRoman,
    9,
    textColor
  );

  const pageNumberText =
    `${String(
      monthIndex + 1
    ).padStart(
      2,
      "0"
    )} / ${year}`;

  drawRight(
    page,
    pageNumberText,
    right,
    PAGE_HEIGHT -
      BLEED -
      SAFE_MARGIN +
      1,
    fonts.helvetica,
    6.5,
    mutedText
  );

  const headingFont =
    monthHeadingFont(
      fonts,
      headerStyle
    );

  const heading =
    monthHeadingText(
      date,
      headerStyle
    );

  const headingSize =
    fitText(
      headingFont,
      heading,
      contentWidth * 0.68,
      normalizeKey(
        headerStyle
      ) === "modernclean"
        ? 22
        : 27,
      15
    );

  page.drawText(
    heading,
    {
      x: left,
      y:
        PAGE_HEIGHT -
        BLEED -
        SAFE_MARGIN -
        29,
      font: headingFont,
      size: headingSize,
      color: accent,
    }
  );

  drawRight(
    page,
    String(year),
    right,
    PAGE_HEIGHT -
      BLEED -
      SAFE_MARGIN -
      24,
    fonts.timesRoman,
    14,
    textColor
  );

  if (subtitle) {
    page.drawText(
      truncateToWidth(
        fonts.helveticaBold,
        subtitle.toUpperCase(),
        5.8,
        contentWidth
      ),
      {
        x: left,
        y:
          PAGE_HEIGHT -
          BLEED -
          SAFE_MARGIN -
          42,
        font:
          fonts.helveticaBold,
        size: 5.8,
        color: mutedText,
      }
    );
  }

  const gridX =
    left;

  const gridY =
    BLEED +
    SAFE_MARGIN +
    18 * MM_TO_POINTS;

  const gridWidth =
    contentWidth;

  const gridTop =
    PAGE_HEIGHT -
    BLEED -
    SAFE_MARGIN -
    50;

  const gridHeight =
    gridTop -
    gridY;

  const cellWidth =
    gridWidth / 7;

  const weekdayHeaderHeight =
    8 * MM_TO_POINTS;

  const dateRowsHeight =
    gridHeight -
    weekdayHeaderHeight;

  const rowHeight =
    dateRowsHeight / 6;

  const weekdayBackground =
    accent;

  const weekdayText =
    contrastingColor(
      weekdayBackground
    );

  const labels =
    weekdayLabels(
      weekdayLabelStyle,
      weekStartsOn
    );

  page.drawRectangle({
    x: gridX,
    y:
      gridTop -
      weekdayHeaderHeight,
    width: gridWidth,
    height:
      weekdayHeaderHeight,
    color:
      weekdayBackground,
  });

  labels.forEach(
    (label, index) => {
      const uppercaseLabel =
        label.toUpperCase();

      const labelSize =
        fitText(
          fonts.helveticaBold,
          uppercaseLabel,
          cellWidth - 4,
          normalizeKey(
            weekdayLabelStyle
          ) === "full"
            ? 5.8
            : 7,
          4
        );

      const safeLabel =
        pdfText(
          uppercaseLabel
        );

      const width =
        fonts.helveticaBold
          .widthOfTextAtSize(
            safeLabel,
            labelSize
          );

      page.drawText(
        safeLabel,
        {
          x:
            gridX +
            index *
              cellWidth +
            (
              cellWidth -
              width
            ) /
              2,
          y:
            gridTop -
            weekdayHeaderHeight +
            (
              weekdayHeaderHeight -
              labelSize
            ) /
              2 +
            1,
          font:
            fonts.helveticaBold,
          size: labelSize,
          color:
            weekdayText,
        }
      );
    }
  );

  const normalizedGridStyle =
    normalizeKey(
      gridStyle
    );

  const drawVerticalLines =
    normalizedGridStyle !==
    "openminimal";

  const gridLineThickness =
    normalizedGridStyle ===
    "boxedgrid"
      ? 0.7
      : 0.4;

  const gridLineColor =
    normalizedGridStyle ===
    "boxedgrid"
      ? mixColor(
          textColor,
          background,
          0.62
        )
      : lineColor;

  if (drawVerticalLines) {
    for (
      let column = 0;
      column <= 7;
      column += 1
    ) {
      const x =
        gridX +
        column *
          cellWidth;

      page.drawLine({
        start: {
          x,
          y: gridY,
        },
        end: {
          x,
          y: gridTop,
        },
        thickness:
          gridLineThickness,
        color:
          gridLineColor,
      });
    }
  }

  for (
    let row = 0;
    row <= 6;
    row += 1
  ) {
    const y =
      gridY +
      row *
        rowHeight;

    page.drawLine({
      start: {
        x: gridX,
        y,
      },
      end: {
        x:
          gridX +
          gridWidth,
        y,
      },
      thickness:
        gridLineThickness,
      color:
        gridLineColor,
    });
  }

  if (
    normalizedGridStyle ===
    "boxedgrid"
  ) {
    page.drawLine({
      start: {
        x: gridX,
        y: gridTop,
      },
      end: {
        x:
          gridX +
          gridWidth,
        y: gridTop,
      },
      thickness:
        gridLineThickness,
      color:
        gridLineColor,
    });
  }

  const daysInMonth =
    new Date(
      year,
      monthIndex + 1,
      0,
      12,
      0,
      0
    ).getDate();

  const startingCell =
    startingCellForMonth(
      year,
      monthIndex,
      weekStartsOn
    );

  for (
    let day = 1;
    day <= daysInMonth;
    day += 1
  ) {
    const cellIndex =
      startingCell +
      day -
      1;

    const column =
      cellIndex % 7;

    const rowFromTop =
      Math.floor(
        cellIndex / 7
      );

    const cellLeft =
      gridX +
      column *
        cellWidth;

    const cellTop =
      gridTop -
      weekdayHeaderHeight -
      rowFromTop *
        rowHeight;

    const dayX =
      cellLeft + 4;

    const dayY =
      cellTop - 10;

    const key =
      dateKey(
        year,
        monthIndex,
        day
      );

    const events =
      eventMap.get(key) ??
      [];

    if (events.length > 0) {
      page.drawCircle({
        x: dayX + 4.5,
        y: dayY + 3.2,
        size: 7,
        color: accent,
      });

      const dayText =
        String(day);

      page.drawText(
        dayText,
        {
          x:
            dayX +
            4.5 -
            fonts.helveticaBold
              .widthOfTextAtSize(
                dayText,
                6.3
              ) /
              2,
          y: dayY + 1,
          font:
            fonts.helveticaBold,
          size: 6.3,
          color:
            contrastingColor(
              accent
            ),
        }
      );
    } else {
      page.drawText(
        String(day),
        {
          x: dayX,
          y: dayY,
          font:
            fonts.timesBold,
          size: 8,
          color: textColor,
        }
      );
    }

    let eventY =
      dayY - 7;

    const maxEventWidth =
      cellWidth - 7;

    for (
      const event of
      events.slice(0, 3)
    ) {
      if (
        eventY <
        cellTop -
          rowHeight +
          3
      ) {
        break;
      }

      const eventSize =
        events.length > 2
          ? 4.2
          : 4.7;

      const label =
        truncateToWidth(
          fonts.helveticaBold,
          event.label.toUpperCase(),
          eventSize,
          maxEventWidth
        );

      page.drawText(
        label,
        {
          x: dayX,
          y: eventY,
          font:
            fonts.helveticaBold,
          size: eventSize,
          color:
            event.priority >=
            60
              ? accent
              : mutedText,
        }
      );

      eventY -=
        eventSize +
        2.2;
    }
  }

  const notesY =
    BLEED +
    SAFE_MARGIN +
    1;

  const notesHeight =
    gridY -
    notesY -
    5;

  drawNotesArea({
    page,
    fonts,
    x: left,
    y: notesY,
    width:
      contentWidth,
    height:
      notesHeight,
    notesLabel,
    notesStyle,
    recurringUnparsed,
    accent,
    textColor,
    lineColor,
  });

  if (footerQuote) {
    const cleanedQuote =
      pdfText(
        footerQuote
      ).replace(
        /^['"]|['"]$/g,
        ""
      );

    const quote =
      `"${cleanedQuote}"`;

    const quoteSize =
      fitText(
        fonts.timesItalic,
        quote,
        contentWidth,
        6.5,
        4.5
      );

    drawCentered(
      page,
      quote,
      BLEED + 3,
      fonts.timesItalic,
      quoteSize,
      mutedText
    );
  }
}

async function generateCalendarPDFs(
  order,
  lineItem
) {
  const properties =
    propertiesToObject(
      lineItem
    );

  /*
   * These names now match the current Shopify
   * calendar form exactly.
   */
  const startDate =
    parseStartMonth(
      getProperty(
        properties,
        [
          "Calendar starting month",
          "Calendar start month",
          "Starting month",
        ],
        ""
      )
    );

  const monthCount =
    parseMonthCount(
      getProperty(
        properties,
        [
          "Calendar length",
          "Number of months",
        ],
        "12 months"
      )
    );

  const calendarTitle =
    getProperty(
      properties,
      [
        "Calendar title",
        "Title",
      ],
      "My Calendar"
    );

  const ownerName =
    getProperty(
      properties,
      [
        "Name family or business",
        "Name, family or business",
        "Owner name",
        "Name",
        "Name or initials",
        "Initials",
      ],
      ""
    );

  const subtitle =
    getProperty(
      properties,
      [
        "Calendar subtitle",
        "Subtitle",
        "Short message",
      ],
      "A year of plans, progress and possibility"
    );

  const headerStyle =
    getProperty(
      properties,
      [
        "Month heading style",
        "Header style",
      ],
      "Script and serif"
    );

  const gridStyle =
    getProperty(
      properties,
      [
        "Calendar grid style",
        "Grid style",
      ],
      "Light grid"
    );

  const weekStartsOn =
    getProperty(
      properties,
      [
        "Week begins on",
        "Week starts on",
      ],
      "Sunday"
    );

  const weekdayLabelStyle =
    getProperty(
      properties,
      [
        "Weekday label style",
        "Weekday labels",
      ],
      "Short"
    );

  const notesLabel =
    getProperty(
      properties,
      [
        "Notes section title",
        "Notes-section title",
        "Notes label",
        "Footer prompt",
      ],
      "Notes and intentions"
    );

  const notesStyle =
    getProperty(
      properties,
      [
        "Notes layout",
        "Notes style",
      ],
      "Lined notes"
    );

  const footerQuote =
    getProperty(
      properties,
      [
        "Monthly footer quote",
        "Footer quote",
        "Monthly footer message",
      ],
      "Make room for what matters."
    );

  const importantDatesValue =
    getProperty(
      properties,
      [
        "Important dates",
        "Special dates",
      ],
      ""
    );

  const recurringDatesValue =
    getProperty(
      properties,
      [
        "Recurring dates and reminders",
        "Recurring dates",
        "Reminders",
      ],
      ""
    );

  const includeHolidays =
    isEnabled(
      getProperty(
        properties,
        [
          "Include standard US holidays",
          "Include standard U.S. holidays",
        ],
        ""
      )
    );

  const includeMoonPhases =
    isEnabled(
      getProperty(
        properties,
        [
          "Include major moon phases",
          "Include moon phases",
        ],
        ""
      )
    );

  const accent =
    parseHexColor(
      getProperty(
        properties,
        [
          "Accent color",
          "Accent",
        ],
        "#BE8755"
      ),
      DEFAULT_ACCENT
    );

  const background =
    parseHexColor(
      getProperty(
        properties,
        [
          "Paper background color",
          "Background color",
          "Paper color",
          "Cover color",
        ],
        "#FFFDF8"
      ),
      DEFAULT_BACKGROUND
    );

  const textColor =
    parseHexColor(
      getProperty(
        properties,
        [
          "Text color",
          "Calendar text color",
        ],
        "#211E1B"
      ),
      DEFAULT_TEXT
    );

  const importantDates =
    parseImportantDates(
      importantDatesValue,
      startDate.getFullYear()
    );

  const recurringRules =
    parseRecurringRules(
      recurringDatesValue
    );

  const unparsedImportantDates =
    importantDates
      .filter(
        (event) =>
          event.unparsed
      )
      .map(
        (event) =>
          event.label
      );

  const recurringUnparsed = [
    ...recurringRules
      .filter(
        (rule) =>
          rule.type ===
          "unparsed"
      )
      .map(
        (rule) =>
          rule.source
      ),
    ...unparsedImportantDates,
  ];

  const eventMap =
    buildEventMap({
      startDate,
      monthCount,
      importantDates,
      recurringRules,
      includeHolidays,
      includeMoonPhases,
    });

  const outputDirectory =
    path.join(
      __dirname,
      "..",
      "generated"
    );

  await fs.promises.mkdir(
    outputDirectory,
    {
      recursive: true,
    }
  );

  const orderId =
    sanitize(
      order?.id ??
        order?.admin_graphql_api_id,
      "order"
    );

  const itemId =
    sanitize(
      lineItem?.id ??
        lineItem?.variant_id,
      "item"
    );

  const productPath =
    path.join(
      outputDirectory,
      `calendar-${orderId}-${itemId}.pdf`
    );

  const pdfDocument =
    await PDFDocument.create();

  pdfDocument.setTitle(
    pdfText(
      calendarTitle,
      "Custom Calendar"
    )
  );

  pdfDocument.setAuthor(
    "Fresh Start Paper"
  );

  pdfDocument.setSubject(
    "Customized A5 landscape wall calendar"
  );

  pdfDocument.setCreator(
    "Fresh Start Paper Calendar Generator"
  );

  pdfDocument.setProducer(
    "Fresh Start Paper"
  );

  const fonts = {
    helvetica:
      await pdfDocument.embedFont(
        StandardFonts.Helvetica
      ),

    helveticaBold:
      await pdfDocument.embedFont(
        StandardFonts.HelveticaBold
      ),

    timesRoman:
      await pdfDocument.embedFont(
        StandardFonts.TimesRoman
      ),

    timesBold:
      await pdfDocument.embedFont(
        StandardFonts.TimesRomanBold
      ),

    timesItalic:
      await pdfDocument.embedFont(
        StandardFonts.TimesRomanItalic
      ),
  };

  /*
   * Page 1: cover.
   */
  drawCover({
    page:
      pdfDocument.addPage([
        PAGE_WIDTH,
        PAGE_HEIGHT,
      ]),
    fonts,
    calendarTitle,
    ownerName,
    subtitle,
    startDate,
    monthCount,
    accent,
    background,
    textColor,
    headerStyle,
  });

  /*
   * Dynamic month pages.
   *
   * A calendar starting August 2026 with an
   * 18-month length ends January 2028.
   */
  for (
    let monthOffset = 0;
    monthOffset < monthCount;
    monthOffset += 1
  ) {
    drawMonth({
      page:
        pdfDocument.addPage([
          PAGE_WIDTH,
          PAGE_HEIGHT,
        ]),
      fonts,
      date:
        addMonths(
          startDate,
          monthOffset
        ),
      calendarTitle,
      ownerName,
      subtitle,
      accent,
      background,
      textColor,
      notesLabel,
      notesStyle,
      footerQuote,
      headerStyle,
      gridStyle,
      weekStartsOn,
      weekdayLabelStyle,
      eventMap,
      recurringUnparsed,
    });
  }

  const pdfBytes =
    await pdfDocument.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

  await fs.promises.writeFile(
    productPath,
    pdfBytes
  );

  const startMonthValue = [
    startDate.getFullYear(),
    String(
      startDate.getMonth() + 1
    ).padStart(2, "0"),
  ].join("-");

  console.log(
    "Calendar PDF generated",
    {
      orderId,
      itemId,
      productPath,
      startMonth:
        startMonthValue,
      monthCount,
      title:
        calendarTitle,
      includeHolidays,
      includeMoonPhases,
      importantDateCount:
        importantDates.filter(
          (event) =>
            !event.unparsed
        ).length,
      recurringRuleCount:
        recurringRules.filter(
          (rule) =>
            rule.type !==
            "unparsed"
        ).length,
    }
  );

  return {
    productPath,

    /*
     * One cover page plus the selected
     * number of monthly pages.
     */
    totalPages:
      monthCount + 1,

    calendarStartMonth:
      startMonthValue,

    calendarLengthMonths:
      monthCount,

    dimensions: {
      widthMm:
        PAGE_WIDTH_MM,
      heightMm:
        PAGE_HEIGHT_MM,
      bleedMm:
        BLEED_MM,
      finishedWidthMm: 210,
      finishedHeightMm: 148,
    },
  };
}

module.exports = {
  generateCalendarPDFs,
};