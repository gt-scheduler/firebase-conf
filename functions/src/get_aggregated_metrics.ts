import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

const firestore = admin.firestore();

const corsHandler = cors({ origin: true });

// Parse raw JSON strings into arrays
// Parse raw JSON strings into arrays
function normalizeArray(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String);
  if (typeof input === "string") return [input];
  return [];
}

export const getAggregatedMetrics = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        // Always parse from `query` for GET
        const source = request.method === "GET" ? request.query : request.body;

        const courses = source.courses;
        const professors = source.professors;
        const metricNames = source.metricNames;
        const semester = source.semester ?? null;

        console.log("Raw query params:", source);

        // Normalize all fields to string[]
        const courseList = normalizeArray(courses);
        const professorList = normalizeArray(professors);
        const metricList = normalizeArray(metricNames);

        let ref: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = firestore.collection("metric_aggregates");

        if (courseList.length > 0 && professorList.length === 0) {
          // only courses
          ref = ref
            .where("type", "==", "course")
            .where("courseId", "in", courseList);

        } else if (courseList.length === 1 && professorList.length > 0) {
          // course_professors
          ref = ref
            .where("type", "==", "course_professor")
            .where("courseId", "==", courseList[0])
            .where("professorId", "in", professorList);

        } else if (courseList.length === 0 && professorList.length > 0) {
          // only professors
          ref = ref
            .where("type", "==", "professor")
            .where("professorId", "in", professorList);
        }

        if (metricList.length > 0) {
          ref = ref.where("metricName", "in", metricList);
        }

        if (semester !== null) {
          ref = ref.where("semester", "==", Number(semester));
        }

        // Query Firestore
        const snapshot = await ref.get();
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return response.status(200).json(data);

      } catch (err) {
        console.error("Error fetching aggregated metrics:", err);
        return response.status(500).json(apiError("Internal server error"));
      }
    });
  });
