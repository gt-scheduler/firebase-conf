import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { MetricData, SubmitMetricsRequestData } from "../utils/types";
import { validateMetricData } from "../utils/validation";

const firestore = admin.firestore();
const auth = admin.auth();

const metricsCollection = firestore.collection(
  "metrics"
) as FirebaseFirestore.CollectionReference<MetricData>;

const corsHandler = cors({ origin: true });

const RATE_LIMIT_SECONDS = 5;

export const submitMetrics = functions
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

        const {
          IDToken,
          metricName,
          targets,
          values,
          semester,
        }: SubmitMetricsRequestData = request.body;

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }

        if (!validateMetricData(request.body)) {
          return response.status(400).json(apiError("Validation failed"));
        }

        // Authenticate token id
        let decodedToken: admin.auth.DecodedIdToken;
        try {
          decodedToken = await auth.verifyIdToken(IDToken);
        } catch {
          return response.status(401).json(apiError("User not found"));
        }

        // Get user id from the decoded token
        const userId = decodedToken.uid;

        try {
          await firestore.runTransaction(async (transaction) => {
            const existingQuery = metricsCollection
              .where("author", "==", userId)
              .where("metricName", "==", metricName);

            const existingDocs = await transaction.get(existingQuery);
            // Either 1 or none since metric is unique based on author and metricName
            const existingDoc = existingDocs.docs[0] || null;

            // This is more accurate than Date.now()
            const currTime = admin.firestore.Timestamp.now();

            if (existingDoc) {
              const existingData = existingDoc.data();
              const existingTargets = existingData.targets;

              const mergedTargets = [...existingTargets];
              let hasOverlap = false;

              targets.forEach((target) => {
                const targetExists = existingTargets.some(
                  (existingTarget) =>
                    existingTarget.type === target.type &&
                    existingTarget.reference === target.reference
                );

                if (targetExists) {
                  hasOverlap = true;
                } else {
                  mergedTargets.push(target);
                }
              });

              if (hasOverlap) {
                const rateLimitThreshold =
                  currTime.toMillis() - RATE_LIMIT_SECONDS * 1000;
                const lastUpdate = existingData.datetime.toMillis();

                if (lastUpdate > rateLimitThreshold) {
                  throw new Error("Rate limit");
                }
              }

              const updateData: Partial<MetricData> = {
                targets: mergedTargets,
                values,
                datetime: currTime,
                semester: semester,
              };

              transaction.update(existingDoc.ref, updateData);
            } else {
              const newDoc: Omit<MetricData, "id"> = {
                metricName: metricName,
                targets,
                author: userId,
                values,
                datetime: currTime,
                semester: semester,
              };

              transaction.create(metricsCollection.doc(), newDoc);
            }
          });
        } catch (err) {
          return response
            .status(500)
            .json(apiError(`Failed to submit metrics - ${err}`));
        }

        return response.status(200).json({ message: "Submitted successfully" });
      } catch (err) {
        return response.status(400).json(apiError("Error submitting metrics"));
      }
    });
  });
