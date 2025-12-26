import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";
import {
  GetRatingsRequestData,
  GetRatingsRequestDataSchema,
} from "../utils/types";
import { DocumentData } from "@google-cloud/firestore";

const firestore = admin.firestore();
const corsHandler = cors({ origin: true });

// TODO: validate types before and after
function normalizeStats(doc: FirebaseFirestore.DocumentData) {
  if (!doc || doc.reviewCount === 0) return null;

  return {
    averageRating: doc.sumOverallRating / doc.reviewCount,
    averageDifficulty: doc.sumDifficulty / doc.reviewCount,
    averageWorkload: doc.sumWorkload / doc.reviewCount,
    reviewCount: doc.reviewCount,
  };
}

export const getRatingStats = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        try {
          request.body = JSON.parse(request.body.data);
        } catch {
          return response.status(400).json(apiError("Bad request"));
        }

        const parsed = GetRatingsRequestDataSchema.safeParse(request.body);
        if (!parsed.success) {
          return response.status(400).json(apiError("Invalid request payload"));
        }

        const { courses, professors } = parsed.data as GetRatingsRequestData;

        const result: any = {
          courses: {},
          professors: {},
        };

        if (courses?.length) {
          const courseDocs = await firestore.getAll(
            ...courses.map((id) => firestore.collection("courseStats").doc(id))
          );

          courseDocs.forEach((doc, idx) => {
            if (doc.exists) {
              result.courses[courses[idx]] = normalizeStats(
                doc.data() as DocumentData
              );
            }
          });
        }

        if (professors?.length) {
          const profDocs = await firestore.getAll(
            ...professors.map((id) =>
              firestore.collection("professorStats").doc(id)
            )
          );

          profDocs.forEach((doc, idx) => {
            if (doc.exists) {
              result.professors[professors[idx]] = normalizeStats(
                doc.data() as DocumentData
              );
            }
          });
        }

        return response.status(200).json(result);
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Failed to fetch stats"));
      }
    });
  });
