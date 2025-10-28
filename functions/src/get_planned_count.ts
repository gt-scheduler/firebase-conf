import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { Version3Schedule, Version3ScheduleData } from "../utils/types";

const firestore = admin.firestore();

const corsHandler = cors({ origin: true });

export const getPlannedCounts = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        const term = request.query["term"];
        if (term == null || term.length === 0) {
          response.status(400).json(apiError("Invalid request"));
          return;
        } else if (typeof term !== "string") {
          response.status(400).json(apiError("Invalid request"));
          return;
        }

        const courseCounts: Record<string, number> = {};
        const sectionCounts: Record<string, number> = {};

        const schedules = await firestore.collection("schedules").get();
        for (const user of schedules.docs) {
          const data = user.data() as Version3ScheduleData;
          const termData = data.terms?.[term];
          if (!termData) continue;

          const versions = termData.versions ?? {};
          if (Object.keys(versions).length == 0) {
            continue;
          }
          const primaryVersion = Object.values(versions)[0]

          const schedule: Version3Schedule = primaryVersion.schedule;
          const pinnedCrns = schedule.pinnedCrns;
          const desiredCourses = schedule.desiredCourses;

          for (const crn of pinnedCrns) {
            sectionCounts[crn] = (sectionCounts[crn] ?? 0) + 1;
          }

          for (const course of desiredCourses) {
            courseCounts[course] = (courseCounts[course] ?? 0) + 1;
          }
        }

        return response.status(200).json({
          term,
          courseCounts,
          sectionCounts,
        });
      } catch (err) {
        console.log(err);
        return response.status(500).json(apiError("Internal error"));
      }
    });
  });
