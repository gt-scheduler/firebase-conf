import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";
import {
  SubmitRatingsRequestData,
  SubmitRatingsRequestDataSchema,
} from "../utils/types";

const firestore = admin.firestore();
const auth = admin.auth();
const corsHandler = cors({ origin: true });

//TODO: figure out behavior when a user submits multiple ratings for the same course/professor/term combination
export const submitRatings = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        try {
          // This request should be made with content type is application/x-www-form-urlencoded.
          // This is done to prevent a pre-flight CORS request made to the firebase function
          // Refer: https://github.com/gt-scheduler/website/pull/187#issuecomment-1496439246
          request.body = JSON.parse(request.body.data);
        } catch {
          return response.status(401).json(apiError("Bad request"));
        }

        // Validate payload
        const parsed = SubmitRatingsRequestDataSchema.safeParse(request.body);

        if (!parsed.success) {
          return response.status(400).json(apiError("Invalid request payload"));
        }

        const { IDToken, ratings } = parsed.data as SubmitRatingsRequestData;

        // Authenticate user
        let decodedToken: admin.auth.DecodedIdToken;
        try {
          decodedToken = await auth.verifyIdToken(IDToken);
        } catch {
          return response.status(401).json(apiError("User not found"));
        }

        const userId = decodedToken.uid;

        await firestore.runTransaction(async (tx) => {
          for (const r of ratings) {
            const {
              courseId,
              professorId,
              term,
              rating,
              difficulty,
              workload,
            } = r;

            const courseStatsRef = firestore
              .collection("courseStats")
              .doc(courseId);

            const professorStatsRef = firestore
              .collection("professorStats")
              .doc(professorId);

            const ratingRef = firestore.collection("ratings").doc();

            // Insert rating
            tx.set(ratingRef, {
              userId,
              courseId,
              professorId,
              term,
              rating,
              difficulty,
              workload,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // Update course stats
            tx.set(
              courseStatsRef,
              {
                sumOverallRating: admin.firestore.FieldValue.increment(rating),
                sumDifficulty: admin.firestore.FieldValue.increment(difficulty),
                sumWorkload: admin.firestore.FieldValue.increment(workload),
                reviewCount: admin.firestore.FieldValue.increment(1),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            // Update professor stats
            tx.set(
              professorStatsRef,
              {
                sumOverallRating: admin.firestore.FieldValue.increment(rating),
                sumDifficulty: admin.firestore.FieldValue.increment(difficulty),
                sumWorkload: admin.firestore.FieldValue.increment(workload),
                reviewCount: admin.firestore.FieldValue.increment(1),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        });

        return response.status(200).json({ success: true });
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error creating invite"));
      }
    });
  });
