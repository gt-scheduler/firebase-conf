// This file is a compilation of the data types of Firebase collections

// This type should automatically accept any schedule data
export type AnyScheduleData = Version2ScheduleData | Version3ScheduleData;
export type AnyScheduleVersion =
  | Version2ScheduleVersion
  | Version3ScheduleVersion;

// Version 2 schedule data (2021-10-26)
// ===================================
//  - addition of unique keys for schedule versions
//  - addition of createdAt fields for schedule versions
//    to provide natural, reconcilable, sort order
//  - removal of all `currentIndex` and `currentTerm` fields
//    (instead stored in separate ui state)

export interface Version2ScheduleData {
  terms: Record<string, Version2TermScheduleData>;
  version: 2;
}

export interface Version2TermScheduleData {
  versions: Record<string, Version2ScheduleVersion>;
}

export interface Version2ScheduleVersion {
  name: string;
  createdAt: string;
  schedule: Version2Schedule;
}

export interface Version2Schedule {
  desiredCourses: string[];
  pinnedCrns: string[];
  excludedCrns: string[];
  colorMap: Record<string, string>;
  sortingOptionIndex: number;
}

// Version 3 schedule data (2023-01-22)
// ===================================
// - addition of custom events

export interface Version3ScheduleData {
  terms: Record<string, Version3TermScheduleData>;
  version: 3;
}

export interface Version3TermScheduleData {
  versions: Record<string, Version3ScheduleVersion>;
}

export interface Version3ScheduleVersion {
  name: string;
  createdAt: string;
  schedule: Version3Schedule;
}

export interface Version3Schedule {
  desiredCourses: string[];
  pinnedCrns: string[];
  excludedCrns: string[];
  events: Event[];
  colorMap: Record<string, string>;
  sortingOptionIndex: number;
}

export interface FriendData {
  terms: Record<string, FriendTermData>;
}

export interface FriendTermData {
  accessibleSchedules: Record<string, string[]>;
}
